import { Telegraf } from "telegraf"
import Customer from "./models/user.model.js"
import MilkHistory from "./models/milkhistory.model.js"
import { getLatestValidRecords } from "./utils/getLatestValid.js"
import {Markup } from "telegraf"
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

bot.command("customers", async (ctx) => {
  try {
    const customers = await Customer.find()

    const latest = await getLatestValidRecords()

    // map for quick lookup
    const latestMap = {}
    latest.forEach(l => {
      latestMap[l._id.toString()] = l
    })

    let msg = "👥 Customers List\n\n"

    customers.forEach((c, i) => {
      const data = latestMap[c._id.toString()]

      let total = 0

      if (data) {
        for (let size in data.morning) {
          total += size * data.morning[size]
        }
        for (let size in data.evening) {
          total += size * data.evening[size]
        }
      }

      msg += `${i + 1}. ${c.name} (${c.phone}) → ${total}L\n`
    })

    ctx.reply(msg)

  } catch {
    ctx.reply("Error ❌")
  }
})

bot.command("customer", async (ctx) => {
  try {
    const phone = ctx.message.text.split(" ")[1]
    if (!phone) return ctx.reply("Usage: /customer phone")

    const customer = await Customer.findOne({ phone })
    if (!customer) return ctx.reply("Customer not found ❌")

    // 📅 Full history (latest first)
    const history = await MilkHistory.find({
      customerId: customer._id
    }).sort({ startDate: -1 })

    let msg = `👤 ${customer.name} (${customer.phone})\n\n`

    // 📅 History
    msg += "📅 History:\n"

    history.forEach(h => {
      let total = 0

      for (let size in h.morning) {
        total += size * h.morning[size]
      }
      for (let size in h.evening) {
        total += size * h.evening[size]
      }

      msg += `${h.displayDate} → ${total}L\n`
    })

    // 📊 Current (latest valid)
    const latest = await getLatestValidRecords()
    const current = latest.find(l => 
      l._id.toString() === customer._id.toString()
    )

    if (current) {
      let m = 0, e = 0

      for (let size in current.morning) {
        m += size * current.morning[size]
      }
      for (let size in current.evening) {
        e += size * current.evening[size]
      }

      msg += `\n📊 Current:\nMorning: ${m}L\nEvening: ${e}L\nTotal: ${m + e}L`
    }

    ctx.reply(msg)

  } catch {
    ctx.reply("Error ❌")
  }
})

bot.command("delete", async (ctx) => {
  const phone = ctx.message.text.split(" ")[1]

  if (!phone) return ctx.reply("Usage: /delete phone")

  const customer = await Customer.findOne({ phone })
  if (!customer) return ctx.reply("Customer not found ❌")

  ctx.reply(
    `⚠️ Are you sure you want to delete ${customer.name}?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Yes Delete", `confirm_delete_${phone}`),
        Markup.button.callback("❌ Cancel", `cancel_delete_${phone}`)
      ]
    ])
  )
})

bot.action(/confirm_delete_(.+)/, async (ctx) => {
  try {
    const phone = ctx.match[1]

    const customer = await Customer.findOne({ phone })
    if (!customer) {
      return ctx.answerCbQuery("Customer not found ❌")
    }

    await MilkHistory.deleteMany({ customerId: customer._id })
    await Customer.deleteOne({ _id: customer._id })

    await ctx.editMessageText(`✅ Deleted: ${customer.name} (${phone})`)

  } catch {
    ctx.answerCbQuery("Error ❌")
  }
})

bot.action(/cancel_delete_(.+)/, async (ctx) => {
  await ctx.editMessageText("❌ Delete cancelled")
})

export default bot