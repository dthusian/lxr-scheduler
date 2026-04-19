import { FluidStack, ItemStack, Side } from "./defs";
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
  inputTanks: TankConfig[]
};

export type RobotControllerConfig = {
  machines: { [id: string]: MachineConfig },
  aeInterface: InventoryConfig
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
  Error
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

export class Controller {
  robotRpc: RobotRpc;
  aeRpc: AeControlRpc;
  config: RobotControllerConfig;

  nextJobId: number;
  jobs: Job[];
  currentX: number;
  currentZ: number;
  ticking: boolean;
  machineUsed: { [x: string]: boolean }

  constructor(robotRpc: RobotRpc, aeRpc: AeControlRpc, config: RobotControllerConfig) {
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
      await this.robotRpc.move(x > 0 ? Side.EAST : Side.WEST, Math.abs(x));
    };
    const moveZ = async (z: number): Promise<void> => {
      await this.robotRpc.move(z > 0 ? Side.SOUTH : Side.NORTH, Math.abs(z));
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

        // try to get ingredients and first fluid (fastpath because singleblocks are max. 1 fluid)
        await Promise.all([
          this.moveRobot(this.config.aeInterface.x, this.config.aeInterface.z),
          this.aeRpc.provideItems(job.def.itemIngredients.map(v => [v.id, v.meta])),
          this.aeRpc.provideFluids(job.def.fluidIngredients.map(v => v.id))
        ]);
        let proms = job.def.itemIngredients.map((v, i) => {
          return this.robotRpc.transfer(
            TransferOps.ItemMachineToSelf,
            this.config.aeInterface.side,
            i, i,
            v.amount,
            v.id,
            v.meta
          );
        });
        if(job.def.fluidIngredients.length) {
          const stack = job.def.fluidIngredients[0];
          proms.push(this.robotRpc.transfer(
            TransferOps.FluidMachineToSelf,
            this.config.aeInterface.side,
            1, 1,
            stack.amount,
            stack.id,
            0
          ));
        }
        // clear interface
        await this.aeRpc.provideItems([]);
        await this.aeRpc.provideFluids([]);

        // some ingredient take resulted in error that isn't missing-items
        const responses = await Promise.all(proms);
        if(responses.some(v => v.status !== RpcStatus.Ok && v.status !== RpcStatus.ErrMissingItems)) {
          job.status = JobStatus.Error;
          return true;
        }

        // return ingredients if they're not all present
        if(responses.some(v => v.status === RpcStatus.ErrMissingItems)) {
          const proms = job.def.itemIngredients.map((v, i) =>
            this.robotRpc.transfer(
              TransferOps.ItemSelfToMachine,
              this.config.aeInterface.side,
              i, i,
              v.amount,
              v.id,
              v.meta
            ));
          if(job.def.fluidIngredients.length) {
            const stack = job.def.fluidIngredients[0];
            proms.push(this.robotRpc.transfer(
              TransferOps.FluidSelfToMachine,
              this.config.aeInterface.side,
              1, 1,
              stack.amount,
              stack.id,
              0
            ));
          }
          const res = await Promise.all(proms);
          
          if(res.some(v => v.status !== RpcStatus.Ok)) {
            job.status = JobStatus.Error;
          } else {
            job.status = JobStatus.MissingIngredients;
          }
          return true;
        }

        // put in the ingredients
        const machineCfg = this.config.machines[job.def.machineId];
        const inv = machineCfg.inputInventory;
        await this.moveRobot(inv.x, inv.z);
        proms = job.def.itemIngredients.map((v, i) => 
          this.robotRpc.transfer(
            TransferOps.ItemSelfToMachine,
            inv.side,
            i, inv.slots[i],
            v.amount,
            v.id,
            v.meta
          )
        );
        if(job.def.fluidIngredients.length) {
          const stack = job.def.fluidIngredients[0];
          const tank0 = machineCfg.inputTanks[0];
          await this.moveRobot(tank0.x, tank0.z);
          proms.push(this.robotRpc.transfer(
            TransferOps.FluidSelfToMachine,
            tank0.side,
            1, 1,
            stack.amount,
            stack.id,
            0
          ));
        }
        const res = await Promise.all(proms);
        if(res.some(v => v.status !== RpcStatus.Ok)) {
          job.status = JobStatus.Error;
        } else {
          job.status = JobStatus.Running;
          job.expectedCompletionTime = Date.now() + 50 * job.def.expectedTicks;
        }

        // gather fluid ingredients
        //TODO

        return true;
      } else if(job.status === JobStatus.Running && job.expectedCompletionTime && job.expectedCompletionTime < Date.now()) {
        // collect non-consumed ingredients
        const machineCfg = this.config.machines[job.def.machineId];
        const inv = machineCfg.inputInventory;
        const res = await Promise.all(job.def.itemIngredients.map((v, i) => {
          if(job.def.itemsNotConsumed[i]) {
            return this.robotRpc.transfer(
              TransferOps.ItemMachineToSelf,
              machineCfg.inputInventory.side,
              i, inv.slots[i],
              v.amount,
              v.id,
              v.meta
            );
          } else {
            return Promise.resolve();
          }
        }));
        if(res.some(v => v && v.status !== RpcStatus.Ok)) {
          job.status = JobStatus.Error;
        }
        return true;
      }
      return true;
    });
    this.ticking = false;
  }
}