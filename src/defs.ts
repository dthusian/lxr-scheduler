export type ItemStack = { id: string, meta: number, amount: number };
export type FluidStack = { id: string, amount: number };
export enum Side {
  BOTTOM = 0,
  TOP = 1,
  NORTH = 2,
  SOUTH = 3,
  WEST = 4,
  EAST = 5,
};