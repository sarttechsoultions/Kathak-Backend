import express from 'express';
import { getStudentById } from './src/modules/admin/admin.controller';

const app = express();

app.get('/test/:id', getStudentById);

app.listen(5001, () => {
  console.log('Test server on 5001');
});
