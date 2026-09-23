import dotenv from "dotenv";
dotenv.config();

import express from "express";
import adminRoutes from "./src/modules/admin/admin.routes";

const app = express();

app.use(express.json());
app.use("/api/v1/admin", adminRoutes);

app.use((err: any, req: any, res: any, next: any) => {
  console.error("Express Error:", err);
  res.status(500).json({ error: err.message });
});

app.listen(5002, () => {
  console.log("Test app running on 5002");
});
