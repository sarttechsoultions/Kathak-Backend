const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
function load(name, prisma, overrides = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/modules/student/', name), 'utf8');
  const testSource = name === 'enrollment.service.ts' ? source + '\nexports.__fulfillEnrollment = fulfillEnrollment;' : source;
  const code = ts.transpileModule(testSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, console, Buffer, process, require: id => {
    if (overrides[id]) return overrides[id];
    if (id === '../../lib/gst') return { calculateGstFromInclusiveTotal: amount => ({taxableBase:amount,cgst:0,sgst:0,igst:0,totalGst:0,gstRate:0}), getInvoiceSacCode:()=>'', getInvoiceSacDescription:()=>'' };
    if (id === '../../lib/businessConfig') return { BUSINESS_DETAILS: {} };
    if (id.includes('/prisma')) return { prisma };
    if (id.includes('notification.controller')) return { createNotification: async () => {}, notifyAdmins: async () => {} };
    if (id === '@prisma/client') return { Role: { STUDENT: 'STUDENT' }, ClassMode: { ONLINE: 'ONLINE' }, PaymentStatus: { SUCCESS: 'SUCCESS' }, PendingEnrollmentStatus: { COMPLETED: 'COMPLETED' } };
    return {};
  }});
  return exports;
}
function response() { return { statusCode: 200, status(n) { this.statusCode=n; return this; }, json(body) { this.body=body; return this; } }; }
function examPrisma(offset) {
  let saved = false;
  return { examResult: {
    findUnique: async () => ({ id: 'attempt', status: 'IN_PROGRESS', exam: { date: new Date(Date.now()-60000+offset), durationMins: 1, questionsData: [], passingMarks: 0, totalMarks: 100 } }),
    updateMany: async ({where}) => { assert.equal(where.status, 'IN_PROGRESS'); if(saved) return {count:0}; saved=true; return {count:1}; }
  }};
}
test('exam rejects submissions beyond the 30-second delivery window', async () => {
  const {submitExam}=load('student.exam.controller.ts', examPrisma(-60000)); const res=response();
  await submitExam({params:{id:'exam'},user:{id:'student'},body:{answers:{}}},res);
  assert.equal(res.statusCode,403); assert.match(res.body.message,/deadline/);
});
test('deadline auto-submit succeeds and concurrent submissions cannot overwrite it', async () => {
  const {submitExam}=load('student.exam.controller.ts',examPrisma(-1000)); const a=response(),b=response();
  const req={params:{id:'exam'},user:{id:'student'},body:{answers:{}}};
  await Promise.all([submitExam(req,a),submitExam(req,b)]);
  assert.deepEqual([a.statusCode,b.statusCode].sort(),[200,409]);
});
test('settings preserve an international number when saving the name', async () => {
  let saved;
  const student={id:'student',phone:'+447700900123',countryCode:'+44'};
  const prisma={user:{findUnique:async()=>student,findFirst:async()=>null,update:async args=>{saved=args.data;return {...student,...args.data};}}};
  const {updateStudentSettingsProfile}=load('student.settings.controller.ts',prisma);const res=response();
  await updateStudentSettingsProfile({user:{id:'student'},body:{fullName:'Student',phone:student.phone}},res);
  assert.equal(res.statusCode,200);assert.equal(saved.phone,student.phone);assert.equal(res.body.data.phone,student.phone);
});
test('settings reject malformed numbers without saving', async () => {
  let updated=false;
  const prisma={user:{findUnique:async()=>({id:'student',phone:'+447700900123',countryCode:'+44'}),update:async()=>{updated=true;}}};
  const {updateStudentSettingsProfile}=load('student.settings.controller.ts',prisma);const res=response();
  await updateStudentSettingsProfile({user:{id:'student'},body:{phone:'1'}},res);
  assert.equal(res.statusCode,400);assert.equal(updated,false);
});

test('active exam results never return questions or answer keys', async () => {
  const prisma={examResult:{findUnique:async()=>({studentId:'student',status:'IN_PROGRESS',exam:{questionsData:[{options:[{isCorrect:true}]}]}})}};
  const {getMyResultDetails}=load('student.exam.controller.ts',prisma);const res=response();
  await getMyResultDetails({params:{resultId:'result'},user:{id:'student'}},res);
  assert.equal(res.statusCode,403);assert.equal(res.body.data,undefined);
});
test('notification failure does not turn a saved exam into a failed submission', async () => {
  const prisma=examPrisma(-1000);
  const {submitExam}=load('student.exam.controller.ts',prisma,{'../notification/notification.controller':{notifyAdmins:async()=>{throw Error('notification unavailable');}}});
  const res=response();await submitExam({params:{id:'exam'},user:{id:'student'},body:{answers:{}}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.data.resultId,'attempt');
});

test('upgrade verifies saved checkout price without reading changed course fees', async () => {
  const crypto=require('node:crypto');let completed=false;
  const pending={id:'pending',userId:'student',razorpayOrderId:'order',currency:'USD',expectedAmount:75,status:'PENDING'};
  const prisma={pendingUpgrade:{findUnique:async()=>pending},course:{findUnique:async()=>{throw Error('Must not recalculate current pricing');}}};
  const {verifyUpgrade}=load('student.controller.ts',prisma,{
    crypto,
    '../../config/env':{env:{razorpayKeySecret:'test-secret'}},
    '../payment/payment.controller':{getRazorpay:()=>({orders:{fetch:async()=>({amount:7500,currency:'USD'})}})},
    './enrollment.service':{completeEnrollmentUpgrade:async()=>{completed=true;return {alreadyCompleted:false};}}
  });
  const res=response();await verifyUpgrade({user:{id:'student'},body:{pendingUpgradeId:'pending',razorpay_order_id:'order',razorpay_payment_id:'payment',razorpay_signature:crypto.createHmac('sha256','test-secret').update('order|payment').digest('hex')}},res);
  assert.equal(res.statusCode,200);assert.equal(completed,true);
});

test('upgrade preserves other courses and creates billing from checkout pricing', async () => {
  const dues=[];let created,removed,selected,invoice;
  const pending={id:'pending',userId:'student',currentEnrollmentId:'old',targetCourseId:'new-course',targetBatchId:'new-batch',targetType:'GROUP',months:3,currency:'USD',expectedAmount:270,razorpayOrderId:'order',status:'PENDING'};
  const tx={
    user:{findUnique:async()=>({id:'student',fullName:'Student'})},
    enrollment:{findUnique:async()=>({id:'old',courseId:'old-course'}),update:async()=>({}),create:async({data})=>{created=data;return {id:'new-enrollment',...data};}},
    batchStudent:{findMany:async({where})=>{selected=where;return [{batchId:'old-batch'}];},deleteMany:async({where})=>{removed=where;},findUnique:async()=>null,create:async()=>({})},
    batch:{findUnique:async()=>({id:'new-batch',courseId:'new-course',name:'Group',code:'GROUP'}),update:async()=>({})},
    monthlyDue:{create:async({data})=>{dues.push(data);}},
    payment:{create:async()=>({id:'upgrade-payment'})},invoiceCounter:{upsert:async()=>({current:1})},invoice:{create:async({data})=>{invoice=data;}},pendingUpgrade:{update:async()=>({})}
  };
  const prisma={pendingUpgrade:{findUnique:async()=>pending},course:{findUnique:async()=>({id:'new-course',title:'New',courseDurationMonths:12})},$transaction:async fn=>fn(tx)};
  const fees={nextCoverageDueDate:(date,months)=>new Date(date.getTime()+months*30*86400000),generateCoverageMonths:()=>['2026-11','2026-12','2027-01'],billingDateForMonth:(y,m)=>new Date(y,m,3),dueMonthFromDate:()=> '2027-02'};
  const {completeEnrollmentUpgrade}=load('enrollment.service.ts',prisma,{
    '../../lib/fees':fees,
    '../../lib/batchHelpers':{isOneToOneBatch:()=>false},
    '../payment/payment.controller':{getRazorpay:()=>({orders:{fetch:async()=>({amount:27000,currency:'USD',notes:{monthlyFee:'100',subtotal:'300',discountPercent:'10',discountAmount:'30'}})}})}
  });
  const result=await completeEnrollmentUpgrade({pendingUpgradeId:'pending',razorpayOrderId:'order',razorpayPaymentId:'payment'});
  assert.equal(selected.batch.courseId,'old-course');
  assert.deepEqual(Array.from(removed.batchId.in),['old-batch']);
  assert.ok(created.nextDueDate>created.billingAnchorDate);
  assert.equal(created.agreedMonthlyFee,100);assert.equal(created.feeCurrency,'USD');
  assert.equal(dues.filter(d=>d.status==='SUCCESS').length,3);
  assert.equal(dues.find(d=>d.status==='PENDING').amount,100);
  assert.equal(dues.filter(d=>d.status==='SUCCESS').reduce((sum,d)=>sum+d.amount,0),270);
  assert.equal(invoice.paymentId,'upgrade-payment');assert.equal(invoice.amount,270);
  assert.equal(result.pricing.discountPercent,10);assert.equal(result.pricing.subtotal,300);
});

test('signed captured-payment webhook recovers an upgrade without browser verification', async () => {
  const crypto=require('node:crypto');let calls=0;
  const {handleRazorpayWebhook}=load('../payment/payment.controller.ts',{pendingUpgrade:{findUnique:async()=>({id:'upgrade'})}},{
    crypto,
    '../../config/env':{env:{razorpayWebhookSecret:'secret'}},
    '../student/enrollment.service':{completeEnrollmentUpgrade:async args=>{assert.equal(args.pendingUpgradeId,'upgrade');assert.equal(args.razorpayOrderId,'order');calls++;}}
  });
  const body={event:'payment.captured',payload:{payment:{entity:{id:'payment',order_id:'order'}}}};
  const rawBody=Buffer.from(JSON.stringify(body));const res=response();
  await handleRazorpayWebhook({body,rawBody,headers:{'x-razorpay-signature':crypto.createHmac('sha256','secret').update(rawBody).digest('hex')}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.status,'ok');assert.equal(calls,1);
});
test('delayed one-to-one confirmation accepts the schedule validated at checkout', async () => {
  let reachedOrder=false;
  const prisma={pendingUpgrade:{findUnique:async()=>({id:'pending',userId:'student',currentEnrollmentId:'old',targetCourseId:'course',targetType:'ONE_TO_ONE',months:1,currency:'USD',expectedAmount:100,razorpayOrderId:'order',preferredDate:'2020-01-01',preferredTime:'10:00 AM',status:'PENDING'})},course:{findUnique:async()=>({id:'course',courseDurationMonths:12})}};
  const {completeEnrollmentUpgrade}=load('enrollment.service.ts',prisma,{'../payment/payment.controller':{getRazorpay:()=>({orders:{fetch:async()=>{reachedOrder=true;throw Error('order-test-sentinel');}}})}});
  await assert.rejects(()=>completeEnrollmentUpgrade({pendingUpgradeId:'pending',razorpayOrderId:'order',razorpayPaymentId:'payment'}),/order-test-sentinel/);
  assert.equal(reachedOrder,true);
});

test('email bypass is rejected while mobile bypass remains available', async () => {
  const {verifyEnrollmentOtp}=load('../../lib/otp.ts',{verificationOtp:{findFirst:async()=>null,create:async()=>({})}},{crypto:require('node:crypto'),'../config/env':{env:{jwtSecret:'test-secret'}}});
  await assert.rejects(()=>verifyEnrollmentOtp({channel:'EMAIL',email:'student@example.com',code:'001122'}),/request an OTP/);
  const result=await verifyEnrollmentOtp({channel:'MOBILE',phone:'9876543210',code:'001122'});
  assert.equal(result.verified,true);
});
test('inactive account cannot use an existing signed token', async () => {
  const {authenticate}=load('../../middleware/auth.middleware.ts',{user:{findUnique:async()=>({isActive:false,role:'STUDENT'})}},{jsonwebtoken:{verify:()=>({id:'student',role:'STUDENT'})},'../config/env':{env:{jwtSecret:'test'}},'../lib/tokenBlocklist':{isTokenRevoked:async()=>false}});
  const res=response();let continued=false;
  await authenticate({headers:{authorization:'Bearer test'}},res,()=>{continued=true;});
  assert.equal(res.statusCode,401);assert.equal(continued,false);
});

test('paid stale renewal cannot reactivate an upgraded enrollment', async () => {
  let lookedUp,updated=false;
  const {__fulfillEnrollment}=load('enrollment.service.ts',{});
  const tx={user:{findFirst:async()=>({id:'student'})},enrollment:{findFirst:async({where})=>{lookedUp=where;return {id:'old',active:false};},update:async()=>{updated=true;}}};
  await assert.rejects(()=>__fulfillEnrollment(tx,{id:'pending',passwordHash:'',payload:{email:'student@example.com',courseId:'old-course',enrollmentId:'old',operationType:'RENEWAL'}},'order','payment'),/no longer active/);
  assert.equal(lookedUp.id,'old');assert.equal(updated,false);
});
test('profile country changes do not change the enrollment billing currency', async () => {
  let usedCurrency;
  const enrollment={id:'enrollment',feeCurrency:'USD',type:'GROUP',course:{id:'course',title:'Course'},nextDueDate:new Date(Date.now()+86400000)};
  const {getStudentAccessState}=load('access.service.ts',{user:{findUnique:async()=>({id:'student',country:'India',enrollments:[enrollment],accessUnlocksReceived:[]})},monthlyDue:{findFirst:async()=>null}},{'../../lib/currency':{resolveCurrency:()=> 'INR'},'../../lib/enrollment-pricing':{enrollmentMonthlyFee:(_e,currency)=>{usedCurrency=currency;return 100;}}});
  const result=await getStudentAccessState('student');
  assert.equal(usedCurrency,'USD');assert.equal(result.currency,'USD');assert.equal(result.isLocked,false);
});
