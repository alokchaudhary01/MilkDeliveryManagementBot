import { Telegraf, Markup } from "telegraf"
import Customer from "./models/user.model.js"
import MilkHistory from "./models/milkhistory.model.js"
import dotenv from "dotenv"

dotenv.config()

const bot = new Telegraf(process.env.BOT_TOKEN)


// ---------- HELPERS ----------

// ✅ Date parser (UTC + display)
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

  const startDate = new Date(Date.UTC(year, month, date))

  const displayDate = `${String(date).padStart(2, "0")}-${String(month + 1).padStart(2, "0")}-${year}`

  return { startDate, displayDate }
}

// ✅ Calculate litres
function calculateLitres(packets) {
  let total = 0
  for (let size in packets) {
    total += Number(size) * packets[size]
  }
  return total
}

// ✅ Parse shorthand input (52m etc)
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
      throw new Error(`Invalid token: ${token}`)
    }

    if (!count || isNaN(count) || count <= 0) {
      throw new Error(`Invalid token: ${token}`)
    }

    if (time === "m") morning[size] += count
    else if (time === "e") evening[size] += count
    else throw new Error(`Invalid token: ${token}`)
  })

  return { morning, evening }
}

// ✅ Latest valid records (ignore future)
async function getLatestValidRecords() {
  const now = new Date()

  const todayEnd = new Date(Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23, 59, 59, 999
  ))

  return await MilkHistory.aggregate([
    { $match: { startDate: { $lte: todayEnd } } },
    { $sort: { startDate: -1 } },
    {
      $group: {
        _id: "$customerId",
        morning: { $first: "$morning" },
        evening: { $first: "$evening" }
      }
    }
  ])
}

// ✅ Overall summary
async function getOverallSummary() {
  const latest = await getLatestValidRecords()

  let totalMorning = 0
  let totalEvening = 0

  latest.forEach(c => {
    totalMorning += calculateLitres(c.morning)
    totalEvening += calculateLitres(c.evening)
  })

  return { totalMorning, totalEvening }
}

// ✅ Format customer summary
function formatCustomerSummary(name, phone, morning, evening) {
  let msg = `✅ Milk Updated\n\n👤 ${name} (${phone})\n\n`

  let total = 0

  msg += "Morning:\n"
  for (let size in morning) {
    if (morning[size] > 0) {
      const val = Number(size) * morning[size]
      total += val
      msg += `${size}L × ${morning[size]} = ${val}L\n`
    }
  }

  msg += "\nEvening:\n"
  for (let size in evening) {
    if (evening[size] > 0) {
      const val = Number(size) * evening[size]
      total += val
      msg += `${size}L × ${evening[size]} = ${val}L\n`
    }
  }

  msg += `\n━━━━━━━━━━━━━━\nTotal per day: ${total}L`
  return msg
}


// ---------- COMMANDS ----------

bot.start(ctx => ctx.reply("Milk Bot Ready 🥛"))

// ➕ ADD
bot.command("add", async (ctx) => {
  const [name, phone] = ctx.message.text.split(" ").slice(1)

  if (!name || !phone) return ctx.reply("Usage: /add name phone")

  const exists = await Customer.findOne({ phone })
  if (exists) return ctx.reply("Already exists ❌")

  await Customer.create({ name, phone })
  ctx.reply("Customer added ✅")
})


// 🔄 SET
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
      displayDate,
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

  } catch (err) {
    ctx.reply(`❌ Invalid format\nExample: /set 98765 52m 252e 0`)
  }
})


// 📊 SUMMARY
bot.command("summary", async (ctx) => {
  const latest = await getLatestValidRecords()

  if (latest.length === 0) {
    return ctx.reply("No milk data found ❌")
  }

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
      totalMorning += Number(size) * morningPackets[size]
    }
  }

  msg += "\nEvening:\n"

  for (let size in eveningPackets) {
    if (eveningPackets[size] > 0) {
      msg += `${size}L → ${eveningPackets[size]} pkt\n`
      totalEvening += Number(size) * eveningPackets[size]
    }
  }

  msg += `\n━━━━━━━━━━━━━━\nTotal Morning: ${totalMorning}L\nTotal Evening: ${totalEvening}L`

  ctx.reply(msg)
})


// 👥 CUSTOMERS LIST
bot.command("customers", async (ctx) => {
  const customers = await Customer.find()
  const latest = await getLatestValidRecords()

  const latestMap = {}
  latest.forEach(l => {
    latestMap[l._id.toString()] = l
  })

  let msg = "👥 Customers List\n\n"

  customers.forEach((c, i) => {
    const data = latestMap[c._id.toString()]
    let total = 0

    if (data) {
      total = calculateLitres(data.morning) + calculateLitres(data.evening)
    }

    msg += `${i + 1}. ${c.name} (${c.phone}) → ${total}L\n`
  })

  ctx.reply(msg)
})


// 👤 CUSTOMER DETAIL
bot.command("customer", async (ctx) => {
  const phone = ctx.message.text.split(" ")[1]

  const customer = await Customer.findOne({ phone })
  if (!customer) return ctx.reply("Customer not found ❌")

  const history = await MilkHistory.find({ customerId: customer._id })
    .sort({ startDate: -1 })

  let msg = `👤 ${customer.name} (${customer.phone})\n\n📅 History:\n`

  history.forEach(h => {
    const total = calculateLitres(h.morning) + calculateLitres(h.evening)
    msg += `${h.displayDate} → ${total}L\n`
  })

  const latest = await getLatestValidRecords()
  const current = latest.find(l => l._id.toString() === customer._id.toString())

  if (current) {
    const m = calculateLitres(current.morning)
    const e = calculateLitres(current.evening)

    msg += `\n📊 Current:\nMorning: ${m}L\nEvening: ${e}L\nTotal: ${m + e}L`
  }

  ctx.reply(msg)
})


// 🗑️ DELETE (WITH BUTTON)
bot.command("delete", async (ctx) => {
  const phone = ctx.message.text.split(" ")[1]

  const customer = await Customer.findOne({ phone })
  if (!customer) return ctx.reply("Customer not found ❌")

  ctx.reply(
    `⚠️ Delete ${customer.name} (${customer.phone})?\nThis will remove ALL history.`,
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
    await ctx.answerCbQuery()

    const phone = ctx.match[1]
    const customer = await Customer.findOne({ phone })

    if (!customer) return ctx.answerCbQuery("Not found ❌")

    await MilkHistory.deleteMany({ customerId: customer._id })
    await Customer.deleteOne({ _id: customer._id })

    await ctx.editMessageText(`✅ Deleted: ${customer.name} (${phone})`)

  } catch {
    ctx.answerCbQuery("Error ❌")
  }
})

bot.action(/cancel_delete_(.+)/, async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.editMessageText("❌ Delete cancelled")
})

bot.command("tomorrow", async (ctx) => {
  try {
    const now = new Date()

    // ✅ Tomorrow end (UTC safe)
    const tomorrowEnd = new Date(Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      23, 59, 59, 999
    ))

    const latest = await MilkHistory.aggregate([
      {
        $match: {
          startDate: { $lte: tomorrowEnd } // 👈 tomorrow tak ka data
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

    if (latest.length === 0) {
      return ctx.reply("No data for tomorrow ❌")
    }

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

    let msg = "📅 Tomorrow Delivery\n\nMorning:\n"

    for (let size in morningPackets) {
      if (morningPackets[size] > 0) {
        msg += `${size}L → ${morningPackets[size]} pkt\n`
        totalMorning += Number(size) * morningPackets[size]
      }
    }

    msg += "\nEvening:\n"

    for (let size in eveningPackets) {
      if (eveningPackets[size] > 0) {
        msg += `${size}L → ${eveningPackets[size]} pkt\n`
        totalEvening += Number(size) * eveningPackets[size]
      }
    }

    msg += `\n━━━━━━━━━━━━━━\nTotal Morning: ${totalMorning}L\nTotal Evening: ${totalEvening}L`

    ctx.reply(msg)

  } catch {
    ctx.reply("Error ❌")
  }
})


export default bot