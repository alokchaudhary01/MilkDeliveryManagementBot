import mongoose from "mongoose"

const milkHistorySchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    required: true
  },

  // ✅ logic ke liye (UTC Date)
  startDate: {
    type: Date,
    required: true
  },

  // ✅ display ke liye (human readable)
  displayDate: {
    type: String,
    required: true
  },

  morning: {
    type: Object,
    default: { "0.25": 0, "0.5": 0, "0.75": 0, "1": 0 }
  },

  evening: {
    type: Object,
    default: { "0.25": 0, "0.5": 0, "0.75": 0, "1": 0 }
  }

}, { timestamps: true })

export default mongoose.model("MilkHistory", milkHistorySchema)