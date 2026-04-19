import { Socket } from "net";
import { createInterface, Interface } from "readline";
import { Side } from "./defs";
import { logDebug } from "./log";

enum RpcOpcodes {
  Reset = 0x1,
  Move = 0x2,
  Transfer = 0x3,
  AeItem = 0x4,
  AeFluid = 0x5
}

export enum RpcStatus {
  Ok = 0x1,
  ErrUnexpectedItem = 0x2,
  ErrCannotMove = 0x3,
  ErrNoInventory = 0x4,
  ErrMissingItems = 0x5,
  ErrOther = 0x6,
}

type RpcResponse<T> = { status: RpcStatus, data: T | null };

function validateData<T>(data: unknown[] | null, types: string[]): T | null {
  if(data === null) return null;
  data.forEach((v, i) => {
    if(types[i] !== typeof v) throw new Error("Invalid response type at index " + i);
  });
  return data as T;
}

function validateRpcData<T>(data: RpcResponse<unknown[]>, types: string[]): RpcResponse<T> {
  return {
    status: data.status,
    data: validateData(data.data, types)
  }
}

export enum TransferOps {
  ItemSelfToMachine = 0x0,
  ItemMachineToSelf = 0x1,
  FluidSelfToMachine = 0x4,
  FluidMachineToSelf = 0x5,
}

export class BaseRpc {
  conn: Socket;
  readline: Interface;
  nextSid: number;
  inflightReqs: { [x: number]: (res: RpcResponse<unknown[]>) => void };

  constructor(conn: Socket, startSid: number) {
    this.conn = conn;
    this.nextSid = startSid;
    this.inflightReqs = {};
    this.readline = createInterface(conn);
    this.readline.on("line", line => {
      try {
        logDebug(`rpc: read: ${line}`);
        this.processRes(line);
      } catch(err) {}
    });
  }

  processRes(line: string) {
    const data = line.split(",");
    const sid = parseInt(data[0]);
    const status = parseInt(data[1]);
    const data2 = data.slice(3);
    if(!this.inflightReqs[sid]) {
      console.log("rpc: warn: unmatched sid " + sid);
    } else {
      this.inflightReqs[sid]({
        status: status,
        data: data2
      });
      delete this.inflightReqs[sid];
    }
  }

  rpc(opcode: number, args: unknown[]): Promise<RpcResponse<unknown[]>> {
    return new Promise((resolve, _) => {
      const sid = this.nextSid++;
      args.forEach(v => {
        if(typeof v === "number") {
        } else if(typeof v === "string") {
          if(v.includes(",")) throw new Error("Argument contains comma");
        } else {
          throw new Error("Only strings and numbers allowed in argument list");
        }
      });
      const requestStr = `${sid},${opcode},${args.toString()}\n`;
      logDebug(`rpc: write: ${requestStr.trim()}`);
      this.conn.write(Buffer.from(requestStr, "utf8"));
      this.inflightReqs[sid] = resolve;
    });
  }
}

export class RobotRpc extends BaseRpc {
  constructor(conn: Socket) {
    super(conn, 100000);
  }

  async reset(): Promise<RpcResponse<[]>> {
    return validateRpcData<[]>(await this.rpc(RpcOpcodes.Reset, []), []);
  }

  async move(side: Side, blocks: number): Promise<RpcResponse<[]>> {
    return validateRpcData<[]>(await this.rpc(RpcOpcodes.Move, [side, blocks]), []);
  }

  async transfer(subOp: TransferOps, side: Side, srcSlot: number, dstSlot: number, amount: number, expectId: string, expectMeta: number): Promise<RpcResponse<[]>> {
    return validateRpcData<[]>(await this.rpc(RpcOpcodes.Transfer, [subOp, side, srcSlot, dstSlot, amount, expectId, expectMeta]), []);
  }
}

export class AeControlRpc extends BaseRpc {
  constructor(conn: Socket) {
    super(conn, 200000);
  }
  
  async provideItems(items: [string, number][]): Promise<RpcResponse<[]>> {
    const args = ([items.length] as (string | number)[]).concat(items.flat());
    return validateRpcData<[]>(await this.rpc(RpcOpcodes.AeItem, args), []);
  }

  async provideFluids(fluids: string[]): Promise<RpcResponse<[]>> {
    const args = ([fluids.length] as (string | number)[]).concat(fluids);
    return validateRpcData<[]>(await this.rpc(RpcOpcodes.AeFluid, args), []);
  }
}