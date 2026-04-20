
export let LOG_LEVEL = 4;

export function logError(s: string) {
  if(LOG_LEVEL >= 1) {
    console.log("error: " + s);
  }
}

export function logWarn(s: string) {
  if(LOG_LEVEL >= 2) {
    console.log("warn: " + s);
  }
}

export function logInfo(s: string) {
  if(LOG_LEVEL >= 3) {
    console.log("info: " + s);
  }
}

export function logDebug(s: string) {
  if(LOG_LEVEL >= 4) {
    console.log("debug: " + s);
  }
}
