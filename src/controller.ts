import { Socket } from "net"
import { RobotRpc, RpcStatus, TransferOps } from "./rpc";

export type InventoryConfig = {
  x: number,
  z: number,
  side: Side,
  slots: number[]
};

export type MachineConfig = {
  inputInventory: InventoryConfig,
  outputInventory: InventoryConfig
};

export type RobotControllerConfig = {
  machines: { [id: string]: MachineConfig },
  aeItemInterface: InventoryConfig,
  robotSlots: number,
  robotTanks: number
};

export type JobDef = {
  machineId: string,
  expectedTicks: number,
  ingredients: ItemStack[],
  results: ItemStack[],
};

export enum JobStatus {
  Dispatched,
  MissingIngredients,
  MissingMachine,
  Running
};

export type Job = {
  jobId: number,
  def: JobDef,
  status: JobStatus,
  currentMachineIndex: number | null,
  expectedCompletionTime: number | null,
  callback: (err?: string) => void
};

async function asyncSeqFilter<T>(arr: T[], cb: (t: T) => Promise<boolean>): Promise<T[]> {
  const filter: boolean[] = [];
  for(let i = 0; i < arr.length; i++) {
    filter.push(await cb(arr[i]));
  }
  return arr.filter((v, i) => filter[i]);
}

export class RobotController {
  rpc: RobotRpc;
  config: RobotControllerConfig;

  nextJobId: number;
  jobs: Job[];
  currentX: number;
  currentZ: number;
  ticking: boolean;
  machineUsed: { [x: string]: boolean }

  constructor(rpc: RobotRpc, config: RobotControllerConfig) {
    this.rpc = rpc;
    this.config = config;

    this.nextJobId = 1;
    this.jobs = [];
    this.currentX = 0;
    this.currentZ = 0;
    this.ticking = false;
    this.machineUsed = {};
  }

  submit(job: JobDef, callback: (err?: string) => void): number {
    const jobId = this.nextJobId++;
    this.jobs.push({
      jobId: jobId,
      def: job,
      status: JobStatus.Dispatched,
      currentMachineIndex: null,
      expectedCompletionTime: null,
      callback: callback
    });
    return jobId;
  }
  
  submitAsync(job: JobDef): Promise<void> {
    return new Promise((resolve, reject) => {
      this.submit(job, (err) => {
        if(err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  jobQueue(): Job[] {
    return this.jobs;
  }

  async moveRobot(targetX: number, targetZ: number) {
    const moveX = async (x: number): Promise<void> => {
      await this.rpc.move(x > 0 ? Side.EAST : Side.WEST, Math.abs(x));
    };
    const moveZ = async (z: number): Promise<void> => {
      await this.rpc.move(z > 0 ? Side.SOUTH : Side.NORTH, Math.abs(z));
    };
    if(targetZ == this.currentZ) {
      await moveZ(targetZ - this.currentZ);
    } else {
      // move to Z = 0
      await moveZ(-this.currentZ);
      // move to targetX
      await moveX(targetX - this.currentX);
      // move to targetZ
      await moveZ(targetZ);
    }
    this.currentX = targetX;
    this.currentZ = targetZ;
  }

  async tick() {
    if(this.ticking) return;
    this.ticking = true;
    this.jobs = await asyncSeqFilter(this.jobs, async job => {
      if(job.status === JobStatus.Dispatched || job.status === JobStatus.MissingIngredients || job.status === JobStatus.MissingMachine) {
        // attempt to schedule
        if(this.machineUsed[job.def.machineId]) {
          job.status = JobStatus.MissingMachine;
          return true;
        }

        // try to get ingredients
        const res = await this.moveRobot(this.config.aeItemInterface.x, this.config.aeItemInterface.z);
        const proms = job.def.ingredients.map((v, i) => {
          return this.rpc.transfer(
            TransferOps.ItemAeToSelf,
            this.config.aeItemInterface.side,
            0, i,
            v.amount,
            v.id,
            v.meta
          );
        });

        // return ingredients if they're not all present
        const responses = await Promise.all(proms);
        if(responses.some(v => v.status !== RpcStatus.Ok)) {
          await Promise.all(job.def.ingredients.map((v, i) =>
            this.rpc.transfer(
              TransferOps.ItemSelfToAe,
              this.config.aeItemInterface.side,
              i, 0,
              v.amount,
              v.id,
              v.meta
            )));
          job.status = JobStatus.MissingIngredients;
          return true;
        }

        // put in the ingredients
        const machineCfg = this.config.machines[job.def.machineId];
        await this.moveRobot(machineCfg.inputInventory.x, machineCfg.inputInventory.z);
        await Promise.all(job.def.ingredients.map((v, i) => 
          this.rpc.transfer(
            TransferOps.ItemSelfToMachine,
            this.config.aeItemInterface.side,
            i, machineCfg.inputInventory.slots[i],
            v.amount,
            v.id,
            v.meta
          )));
        job.status = JobStatus.Running;
        job.expectedCompletionTime = Date.now() + 50 * job.def.expectedTicks;
        return true;
      } else if(job.status === JobStatus.Running && job.expectedCompletionTime && job.expectedCompletionTime < Date.now()) {
        // collect results
        const machineCfg = this.config.machines[job.def.machineId];
        await this.moveRobot(machineCfg.outputInventory.x, machineCfg.outputInventory.z);
        const responses = await Promise.all(job.def.results.map((v, i) => 
          this.rpc.transfer(
            TransferOps.ItemMachineToSelf,
            machineCfg.outputInventory.side,
            machineCfg.outputInventory.slots[i], i,
            v.amount,
            v.id,
            v.meta
          )));
        if(responses.some(v => v.status !== RpcStatus.Ok)) {
          console.log("control: warn: collecting item resulted in err");
        }
        await this.moveRobot(machineCfg.outputInventory.x, machineCfg.outputInventory.z);
        await Promise.all(job.def.results.map((v, i) => {
          this.rpc.transfer(
            TransferOps.ItemSelfToAe,
            this.config.aeItemInterface.side,
            i, 0,
            v.amount,
            v.id,
            v.meta
          )
        }));
      }
      return true;
    });
    this.ticking = false;
  }
}