import { calculateGstFromInclusiveTotal } from './src/lib/gst';
process.env.GST_RATE = '18';
process.env.ACADEMY_STATE = 'Rajasthan';
const res = calculateGstFromInclusiveTotal(3300, 'Rajasthan');
console.log(JSON.stringify(res, null, 2));
