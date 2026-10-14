export async function register() {
  if(process.env.NEXT_RUNTIME==="nodejs") {
    const { startObservationWorker }=await import("./lib/learning/worker");
    startObservationWorker();
  }
}
