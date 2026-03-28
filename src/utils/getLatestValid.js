// utils/getLatestValid.js

import MilkHistory from "../models/milkhistory.model.js"

export async function getLatestValidRecords() {

  // 🔥 Local (IST-safe) today
  const now = new Date()
const todayEnd = new Date(Date.UTC(
  now.getFullYear(),
  now.getMonth(),
  now.getDate(),
  23, 59, 59, 999
))

 const latest = await MilkHistory.aggregate([
  {
    $match: {
      startDate: { $lte: todayEnd } // ✅ now works
    }
  },
  { $sort: { startDate: -1 } },
  {
    $group: {
      _id: "$customerId",
      morning: { $first: "$morning" },
      evening: { $first: "$evening" }
    }
  }
])

  return latest
}