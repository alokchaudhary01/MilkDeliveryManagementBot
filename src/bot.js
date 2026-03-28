import { Telegraf } from "telegraf"
import Customer from "./models/user.model.js"
import MilkHistory from "./models/milkhistory.model.js"
import { getLatestValidRecords } from "./utils/getLatestValid.js"
import dotenv from "dotenv"
dotenv.config()

const bot = new Telegraf(process.env.BOT_TOKEN)


// ---------- HELPERS ----------
function parseDate(input = "0") {
  const now = new Date()

  let year = now.getFullYear()
  let month = now.getMonth()
  let date = now.getDate()

  if (!isNaN(input)) {
    date += Number(input)
  } else {
    const d = new Date(input)
    year = d.getFullYear()
    month = d.getMonth()
    date = d.getDate()
  }

  // ✅ UTC date for DB
  const startDate = new Date(Date.UTC(year, month, date))

  // ✅ display string
  const displayDate = `${String(date).padStart(2, "0")}-${String(month + 1).padStart(2, "0")}-${year}`

  return { startDate, displayDate }
}

function calculateLitres(packets) {
  let total = 0
  for (let size in packets) {
    total += Number(size) * packets[size]
  }
  return total
}

function parseInput(tokens) {
  const morning = { "0.25": 0, "0.5": 0, "0.75": 0, "1": 0 }
  const evening = { "0.25": 0, "0.5": 0, "0.75": 0, "1": 0 }

  tokens.forEach(token => {
    const time = token.slice(-1)
    const value = token.slice(0, -1)

    let size, count

    if (value.startsWith("25")) {
      size = 0.25
      count = Number(value.slice(2))
    } else if (value.startsWith("75")) {
      size = 0.75
      count = Number(value.slice(2))
    } else if (value.startsWith("5")) {
      size = 0.5
      count = Number(value.slice(1))
    } else if (value.startsWith("1")) {
      size = 1
      count = Number(value.slice(1))
    } else {
      throw new Error("Invalid token")
    }

    if (!count || count <= 0) return

    if (time === "m") morning[size] += count
    else if (time === "e") evening[size] += count
  })

  return { morning, evening }
}

function formatCustomerSummary(name, phone, morning, evening) {
  let msg = `✅ Milk Updated\n\n👤 ${name} (${phone})\n\n`

  let total = 0

  msg += "Morning:\n"
  for (let size in morning) {
    if (morning[size] > 0) {
      const val = size * morning[size]
      total += val
      msg += `${size}L × ${morning[size]} = ${val}L\n`
    }
  }

  msg += "\nEvening:\n"
  for (let size in evening) {
    if (evening[size] > 0) {
      const val = size * evening[size]
      total += val
      msg += `${size}L × ${evening[size]} = ${val}L\n`
    }
  }

  msg += `\n━━━━━━━━━━━━━━\nTotal per day: ${total}L`
  return msg
}


// ---------- OVERALL SUMMARY ----------
async function getOverallSummary() {
  const latest = await getLatestValidRecords()

  let totalMorning = 0
  let totalEvening = 0

  latest.forEach(c => {
    for (let size in c.morning) {
      totalMorning += Number(size) * c.morning[size]
    }
    for (let size in c.evening) {
      totalEvening += Number(size) * c.evening[size]
    }
  })

  return { totalMorning, totalEvening }
}


// ---------- COMMANDS ----------
bot.start(ctx => ctx.reply("Milk Bot Ready 🥛"))

bot.command("add", async (ctx) => {
  const [name, phone] = ctx.message.text.split(" ").slice(1)

  if (!name || !phone) return ctx.reply("Usage: /add name phone")

  const exists = await Customer.findOne({ phone })
  if (exists) return ctx.reply("Already exists ❌")

  await Customer.create({ name, phone })
  ctx.reply("Customer added ✅")
})


bot.command("set", async (ctx) => {
  try {
    const parts = ctx.message.text.split(" ").slice(1)

    const phone = parts[0]
    const last = parts[parts.length - 1]

    const dateInput = (isNaN(last) && !last.includes("-")) ? "0" : last
    const tokens = parts.slice(1, dateInput === last ? -1 : undefined)

    const { morning, evening } = parseInput(tokens)

    const customer = await Customer.findOne({ phone })
    if (!customer) return ctx.reply("Customer not found ❌")

    const { startDate, displayDate } = parseDate(dateInput)

await MilkHistory.deleteOne({
  customerId: customer._id,
  startDate
})

await MilkHistory.create({
  customerId: customer._id,
  startDate,
  displayDate, // ✅ add this
  morning,
  evening
})
    const summaryMsg = formatCustomerSummary(
      customer.name,
      phone,
      morning,
      evening
    )

    const overall = await getOverallSummary()

  ctx.reply(
  summaryMsg +
  `\n\n📊 Updated Delivery:\nMorning: ${overall.totalMorning}L\nEvening: ${overall.totalEvening}L`
)

  } catch {
    ctx.reply("❌ Invalid format\nExample: /set 98765 52m 252e 0")
  }
})



bot.command("summary", async (ctx) => {
  const latest = await getLatestValidRecords()

  const morningPackets = { "0.25": 0, "0.5": 0, "0.75": 0, "1": 0 }
  const eveningPackets = { "0.25": 0, "0.5": 0, "0.75": 0, "1": 0 }

  let totalMorning = 0
  let totalEvening = 0

  latest.forEach(c => {
    for (let size in c.morning) {
      morningPackets[size] += c.morning[size] || 0
    }

    for (let size in c.evening) {
      eveningPackets[size] += c.evening[size] || 0
    }
  })

  let msg = "🥛 Milk Summary\n\nMorning:\n"

  for (let size in morningPackets) {
    if (morningPackets[size] > 0) {
      msg += `${size}L → ${morningPackets[size]} pkt\n`
      totalMorning += size * morningPackets[size]
    }
  }

  msg += "\nEvening:\n"

  for (let size in eveningPackets) {
    if (eveningPackets[size] > 0) {
      msg += `${size}L → ${eveningPackets[size]} pkt\n`
      totalEvening += size * eveningPackets[size]
    }
  }

  msg += `\n━━━━━━━━━━━━━━\nTotal Morning: ${totalMorning}L\nTotal Evening: ${totalEvening}L`

  ctx.reply(msg)
})

export default bot