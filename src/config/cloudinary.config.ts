import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "tnxzkjwa",
  api_key: process.env.CLOUDINARY_API_KEY || "931663451392748",
  api_secret: process.env.CLOUDINARY_API_SECRET || "dr684W_0VwToQXApZpTtyJGIJcg",
});

export default cloudinary;
