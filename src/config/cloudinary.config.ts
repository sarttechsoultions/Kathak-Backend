import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "mlw5mnjj",
  api_key: process.env.CLOUDINARY_API_KEY || "831628169969395",
  api_secret: process.env.CLOUDINARY_API_SECRET || "4alkKnfjhCdRzcktLsP0ITFMcMg",
});

export default cloudinary;
