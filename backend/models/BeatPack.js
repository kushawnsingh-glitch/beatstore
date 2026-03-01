import mongoose from 'mongoose';

const licenseSchema = new mongoose.Schema({
  type: { type: String, required: true },
  price: { type: Number, required: true },
  currency: { type: String, required: true },
  description: { type: String, required: true },
  s3_file_url: { type: String, required: true },
  features: [{ type: String }],
});

const beatPackSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    price: { type: Number, required: true },
    tags: [{ type: String }],
    s3_image_url: { type: String, required: true },
    s3_mp3_url: { type: String, required: true },
    s3_free_url: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
    available: { type: Boolean, default: true },
    type: { type: String, default: 'Beat Pack' }, // Defaulted to Beat Pack
    licenses: [licenseSchema],
  },
  { timestamps: true }
);

// We export this as 'BeatPack' and link it to the 'beatPacks' collection
export default mongoose.model('BeatPack', beatPackSchema, 'beatPacks');
