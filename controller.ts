import { Socket } from "net"

export type RobotControllerConfig = {
  machines: ({
    x: number,
    y: number,
    side: Side,
    id: string
  })[]
};

export type JobDef = {
  machineId: string,
  ingredients: ItemStack[],
  results: ItemStack[],
};

export type Job = {
  def: JobDef,
  expectedCompletionTime: number | null, // null if not being completed
};

export class RobotController {
  conn: Socket;
  config: RobotControllerConfig;

  queuedJobs: Job[];
  currentX: number;
  currentY: number;

  constructor(conn: Socket, config: RobotControllerConfig) {
    this.conn = conn;
    this.config = config;

    this.queuedJobs = [];
    this.currentX = 0;
    this.currentY = 0;
  }

  submit(job: JobDef) {
    this.queuedJobs.push({
      def: job,
      expectedCompletionTime: null
    });
  }

  jobQueue(): Job[] {
    return this.queuedJobs;
  }
}