function test() {
  const now = new Date();
  const scheduledStart = new Date(now.getTime() + 601000);
  
  const controllerNow = new Date(now.getTime() + 5);
  
  const earlyAccessTime = new Date(scheduledStart.getTime() - 10 * 60 * 1000);
  
  console.log('scheduledStart:', scheduledStart);
  console.log('earlyAccessTime:', earlyAccessTime);
  console.log('controllerNow:', controllerNow);
  console.log('controllerNow < earlyAccessTime:', controllerNow < earlyAccessTime);
}

test();
