import { FluidStack, ItemStack, Side } from "./defs";
import { logInfo } from "./log";
import { AeControlRpc, RobotRpc, RpcStatus, TransferOps } from "./rpc";

export type InventoryConfig = {
  x: number,
  z: number,
  side: Side,
  slots: number[]
};

export type TankConfig = {
  x: number,
  z: number,
  side: Side,
  tankIndex: number
};

export type MachineConfig = {
  inputInventory: InventoryConfig,
  inputTanks: TankConfig[],
  itemId: string,
  itemMeta: number
};

export type ControllerConfig = {
  machines: { [id: string]: MachineConfig },
  provideInterface: InventoryConfig,
  dumpInterface: InventoryConfig,
  robotItemSlots: number[],
  robotTankSlots: number[],
  robotScratchSlot: number,
  timeMarginTicks: number,
};

export type JobDef = {
  name: string,
  machineId: string,
  expectedTicks: number,
  itemIngredients: ItemStack[],
  fluidIngredients: FluidStack[],
  itemsNotConsumed: boolean[]
};

export enum JobStatus {
  Dispatched,
  MissingIngredients,
  MissingMachine,
  Running,
  Error,
  Complete
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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
} 

export class Controller {
  robotRpc: RobotRpc;
  aeRpc: AeControlRpc;
  config: ControllerConfig;

  nextJobId: number;
  jobs: Job[];
  currentX: number;
  currentZ: number;
  ticking: boolean;
  machineUsed: { [x: string]: boolean }

  constructor(robotRpc: RobotRpc, aeRpc: AeControlRpc, config: ControllerConfig) {
    this.robotRpc = robotRpc;
    this.aeRpc = aeRpc;
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
      if(x !== 0) await this.robotRpc.move(x > 0 ? Side.EAST : Side.WEST, Math.abs(x));
    };
    const moveZ = async (z: number): Promise<void> => {
      if(z !== 0) await this.robotRpc.move(z > 0 ? Side.SOUTH : Side.NORTH, Math.abs(z));
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
    logInfo("control: begin tick");
    this.jobs = await asyncSeqFilter(this.jobs, async job => {
      if(job.status === JobStatus.Dispatched || job.status === JobStatus.MissingIngredients || job.status === JobStatus.MissingMachine) {
        // checks that will disallow scheduling entirely

        if(this.machineUsed[job.def.machineId]) {
          job.status = JobStatus.MissingMachine;
          return true;
        }
        
        // wrapper so that if it returns false out of this, we dump robot inventory
        const commit = await (async () => {

          // move robot to provider and provide items
          await Promise.all([
            this.moveRobot(this.config.provideInterface.x, this.config.provideInterface.z),
            this.aeRpc.provideItems(job.def.itemIngredients.map(v => [v.id, v.meta]))
          ]);
          await sleep(200);

          let proms = job.def.itemIngredients.map((v, i) => {
            return this.robotRpc.transfer(
              TransferOps.ItemMachineToSelf,
              this.config.provideInterface.side,
              i + 1, this.config.robotItemSlots[i],
              v.amount,
              v.id,
              v.meta
            );
          });
          let responses = await Promise.all(proms);

          for(let [v, i] of job.def.fluidIngredients.map((v, i) => [v, i] as [FluidStack, number])) {
            await this.aeRpc.provideFluids([v.id]);
            await sleep(200);
            const res = await this.robotRpc.transfer(
              TransferOps.FluidMachineToSelf,
              this.config.provideInterface.side,
              1, this.config.robotTankSlots[i],
              v.amount,
              v.id,
              0
            );
            responses.push(res);
          }

          // some ingredient take resulted in error that isn't missing-items
          if(responses.some(v => v.status !== RpcStatus.Ok && v.status !== RpcStatus.ErrUnexpectedItem)) {
            job.status = JobStatus.Error;
            return false;
          }

          // return ingredients if they're not all present
          if(responses.some(v => v.status === RpcStatus.ErrUnexpectedItem)) {
            job.status = JobStatus.MissingIngredients;
            return false;
          }

          // put in the items
          const machineCfg = this.config.machines[job.def.machineId];
          const inv = machineCfg.inputInventory;
          await this.moveRobot(inv.x, inv.z);
          responses = await Promise.all(job.def.itemIngredients.map((v, i) => 
            this.robotRpc.transfer(
              TransferOps.ItemSelfToMachine,
              inv.side,
              i + 1, inv.slots[i],
              v.amount,
              v.id,
              v.meta
            )
          ));
          if(responses.some(v => v.status !== RpcStatus.Ok)) {
            job.status = JobStatus.Error;
            return false;
          }
          // put in fluids
          for(let [v, i] of job.def.fluidIngredients.map((v, i) => [v, i] as [FluidStack, number])) {
            await this.moveRobot(machineCfg.inputTanks[i].x, machineCfg.inputTanks[i].z);
            const res = await this.robotRpc.transfer(
              TransferOps.FluidSelfToMachine,
              machineCfg.inputTanks[i].side,
              this.config.robotTankSlots[i], 1,
              v.amount,
              v.id,
              0
            );
            if(res.status != RpcStatus.Ok) {
              job.status = JobStatus.Error;
              return false;
            }
          }

          // committed now
          job.status = JobStatus.Running;
          job.expectedCompletionTime = Date.now() + 50 * (job.def.expectedTicks + this.config.timeMarginTicks);
          this.machineUsed[job.def.machineId] = true;

          return true;
        })();
        
        if(!commit) {
          // dump inventory
          await this.moveRobot(this.config.dumpInterface.x, this.config.dumpInterface.z);
          await this.robotRpc.dumpInventory(this.config.dumpInterface.side);
        }

        return true;
      } else if(job.status === JobStatus.Running && job.expectedCompletionTime && job.expectedCompletionTime < Date.now()) {
        const machineCfg = this.config.machines[job.def.machineId];
        // collect non-consumed ingredients
        if(job.def.itemsNotConsumed.some(v => v)) {
          // todo: probably want to check that machine is not running
          await this.moveRobot(machineCfg.inputInventory.x, machineCfg.inputInventory.z);
          await this.robotRpc.breakReplace(machineCfg.itemId, machineCfg.itemMeta);
          await this.moveRobot(this.config.dumpInterface.x, this.config.dumpInterface.z);
          await this.robotRpc.dumpInventory(this.config.dumpInterface.side);
        }
        job.status = JobStatus.Complete;
        this.machineUsed[job.def.machineId] = false;
        return true;
      }
      return true;
    });
    logInfo("control: end tick");
    this.ticking = false;
  }
}