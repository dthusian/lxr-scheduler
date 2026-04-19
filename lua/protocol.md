# Control Protocols

Basic format: all fields are flattened and sent as comma-separated values
Commas are not allowed in strings

Request:
- `sid: number`
  - Transaction id, response must have an sid that matches this
- `opcode: number`
  - Opcode, see below for specific opcodes
  - Opcodes will not overlap between different protocols to avoid confusion if ports are setup wrong
- `data: see below`
  - These are the fields on the left side of the arrow for a given RPC
Response:
- `sid: number`
  - Transaction id matching the request sid
- `status: number`
  - See status definition below
- `data: see below`
  - These are the fields on the right side of the arrow for a given RPC

## Robot

RPCs
- 0x1: reset `() -> ()`
- 0x2: move `(side: number, blocks: number) -> ()`
  - side is the same definition as in opencomputers
- 0x3: transfer `(subop: number, side: number, srcSlot: number, dstSlot: number, amount: number, expectId: string, expectMeta: number) -> ()`
  - sub-opcodes
  - 0x0 item self->machine
  - 0x1 item machine->self
  - 0x4 fluid self->machine
  - 0x5 fluid machine->self

statuses
- 0x1: ok
- 0x2: error, unexpected item (expectId or expectMeta doesn't match)
- 0x3: error, cannot move (robot is unable to move to that position)
- 0x4: error, no inventory there/invalid slot (no inventory at that position or the slot was invalid)
- 0x5: error, missing/not enough items (no itemstack in that slot or there was not enough to fill amount)
- 0x6: error, other (lua error or something else)

## AE2 Interface

packet format is the same as robot protocol

- 0x4: provideItems `(nItems: number, item1Id: string, item1Meta: number, item2Id: string, item2Meta: number, ...) -> ()`
  - maximum 9 items
- 0x5: provideFluids `(nFluids: number, fluid1Id: string, fluid2Id: string, ...)`
  - maximum 6 fluids

status
0x1: ok
0x6: err, other (lua error or something else)