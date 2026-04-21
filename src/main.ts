import { createServer } from "net";
import { AeControlRpc, RobotRpc } from "./rpc";
import { Controller, RobotControllerConfig as ControllerConfig, JobDef, JobStatus } from "./controller";
import { Side } from "./defs";

const config: ControllerConfig = {
  machines: {
    wiremill: {
      inputInventory: {
        x: 0,
        z: -2,
        side: Side.TOP,
        slots: [6, 7]
      },
      inputTanks: [],
      itemId: "gregtech:gt.blockmachines",
      itemMeta: 353
    },
    extruder: {
      inputInventory: {
        x: 0,
        z: -3,
        side: Side.TOP,
        slots: [6, 7]
      },
      inputTanks: [],
      itemId: "gregtech:gt.blockmachines",
      itemMeta: 283
    },
    assembler: {
      inputInventory: {
        x: 0,
        z: -4,
        side: Side.TOP,
        slots: [6, 7, 8, 9, 10, 11, 12, 13, 14]
      },
      inputTanks: [
        {
          x: 0,
          z: -4,
          side: Side.TOP,
          tankIndex: 1
        }
      ],
      itemId: "gregtech:gt.blockmachines",
      itemMeta: 213
    },
    polarizer: {
      inputInventory: {
        x: 0,
        z: -5,
        side: Side.WEST,
        slots: [6]
      },
      inputTanks: [],
      itemId: "gregtech:gt.blockmachines",
      itemMeta: 553
    }
  },
  provideInterface: {
    x: 0,
    z: 0,
    side: Side.WEST,
    slots: [1, 2, 3, 4, 5, 6, 7, 8, 9]
  },
  dumpInterface: {
    x: 0,
    z: 0,
    side: Side.EAST,
    slots: [1, 2, 3, 4, 5, 6, 7, 8, 9]
  },
  robotItemSlots: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  robotTankSlots: [11, 12, 13, 14, 15, 16],
  robotScratchSlot: 10
};

const jobs: JobDef[] = [
  {
    name: "4 * Electric Motor (EV)",
    machineId: "assembler",
    expectedTicks: 20,
    itemIngredients: [
      { id: "gregtech:gt.metaitem.01", meta: 23356, amount: 4 },
      { id: "gregtech:gt.metaitem.01", meta: 23028, amount: 8 },
      { id: "gregtech:gt.blockmachines", meta: 1542, amount: 16 },
      { id: "gregtech:gt.blockmachines", meta: 1587, amount: 8 },
    ],
    fluidIngredients: [],
    itemsNotConsumed: [false, false, false, false]
  },
  {
    name: "8 * Titanium Rod",
    machineId: "extruder",
    expectedTicks: 192,
    itemIngredients: [
      { id: "gregtech:gt.metaitem.01", meta: 11028, amount: 4 },
      { id: "gregtech:gt.metaitem.01", meta: 32351, amount: 1 }
    ],
    fluidIngredients: [],
    itemsNotConsumed: [false, true]
  },
  {
    name: "4 * Neodymium Rod",
    machineId: "extruder",
    expectedTicks: 288,
    itemIngredients: [
      { id: "gregtech:gt.metaitem.01", meta: 11067, amount: 2 },
      { id: "gregtech:gt.metaitem.01", meta: 32351, amount: 1 }
    ],
    fluidIngredients: [],
    itemsNotConsumed: [false, true]
  },
  {
    name: "8 * 2x Aluminium Wire",
    machineId: "wiremill",
    expectedTicks: 304,
    itemIngredients: [
      { id: "gregtech:gt.metaitem.01", meta: 11019, amount: 8 },
      { id: "gregtech:gt.integrated_circuit", meta: 2, amount: 1 },
    ],
    fluidIngredients: [],
    itemsNotConsumed: [false, true]
  },
  {
    name: "8 * 2x Aluminium Cable",
    machineId: "assembler",
    expectedTicks: 200,
    itemIngredients: [
      { id: "gregtech:gt.blockmachines", meta: 1581, amount: 8 },
      { id: "gregtech:gt.integrated_circuit", meta: 24, amount: 1 },
    ],
    fluidIngredients: [
      { id: "molten.rubber", amount: 1152 }
    ],
    itemsNotConsumed: [false, true]
  },
  {
    name: "4 * Magnetic Neodymium Rod",
    machineId: "polarizer",
    expectedTicks: 256,
    itemIngredients: [
      { id: "gregtech:gt.metaitem.01", meta: 23067, amount: 4 }
    ],
    fluidIngredients: [],
    itemsNotConsumed: [false]
  },
  {
    name: "16 * 4x Black Steel Wire",
    machineId: "wiremill",
    expectedTicks: 800,
    itemIngredients: [
      { id: "gregtech:gt.metaitem.01", meta: 11334, amount: 32 },
      { id: "gregtech:gt.integrated_circuit", meta: 4, amount: 1 }
    ],
    fluidIngredients: [],
    itemsNotConsumed: [false, true]
  }
];

let robotRpc: RobotRpc | undefined = undefined;
let aeRpc: AeControlRpc | undefined = undefined;
let controller: Controller | undefined = undefined;

function checkAndCreateController() {
  if(robotRpc && aeRpc && !controller) {
    const myController = new Controller(robotRpc, aeRpc, config);
    jobs.forEach(v => {
      myController.submit(v, () => console.log(`job ${v.name} completed`));
    });
    controller = myController;
  }
}

createServer(sock => {
  console.log("got robot connection");
  robotRpc = new RobotRpc(sock);
  checkAndCreateController();
}).listen(3000);

createServer(sock => {
  console.log("got ae connection");
  aeRpc = new AeControlRpc(sock);
  checkAndCreateController();
}).listen(3001);

setInterval(() => {
  if(controller) {
    controller.tick();
  }
}, 500);

process.stdin.on("data", () => {
  if(controller) {
    console.log("---");
    controller.jobQueue().forEach(v => {
      let statusStr = "";
      if(v.status === JobStatus.Dispatched) {
        statusStr = "Dispatched";
      } else if(v.status === JobStatus.MissingIngredients) {
        statusStr = "Waiting for ingredients";
      } else if(v.status === JobStatus.MissingMachine) {
        statusStr = "Waiting for machine";
      } else if(v.status === JobStatus.Running) {
        if(v.expectedCompletionTime) {
          const dur = v.expectedCompletionTime - Date.now();
          statusStr = "Running: " + Math.floor(dur / 1000);
        } else {
          statusStr = "Running";
        }
      } else if (v.status === JobStatus.Error) {
        statusStr = "Error";
      }
      console.log(`${v.def.name} ${statusStr}`);
    });
    console.log("---");
  }
});