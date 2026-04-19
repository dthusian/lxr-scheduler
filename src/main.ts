import { createServer } from "net";

createServer(sock => {
  console.log("got connection, sending commands...");
  sock.write("111,4,3,gregtech:gt.metaitem.01,11028,gregtech:gt.metaitem.01,32351,gregtech:gt.integrated_circuit,2\n");
  sock.write("222,5,2,molten.rubber,water\n");
  sock.on("data", data => {
    console.log("response: " + data + "\n");
  });
  sock.on("close", () => process.exit(0));
}).listen(3001)