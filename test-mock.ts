import { getStudentById } from './src/modules/admin/admin.controller';

const req = {
  params: { id: '06eb932a-3077-4a6d-8ff0-bf19c4b4f728' }
} as any;

const res = {
  status: function(code: number) {
    this.statusCode = code;
    return this;
  },
  json: function(data: any) {
    console.log("Response Status:", this.statusCode || 200);
    // console.log("Response Data:", JSON.stringify(data, null, 2));
    console.log("Success!");
  }
} as any;

getStudentById(req, res).then(() => {
  console.log("Function completed");
}).catch(err => {
  console.error("Uncaught exception:", err);
});
