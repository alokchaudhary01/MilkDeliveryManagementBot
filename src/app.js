import mongoose from "mongoose"
import dotenv from "dotenv"
import bot from "./bot.js"

dotenv.config()

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected ✅")
    bot.launch()
    console.log("Bot Started 🚀")
  })
  .catch(err => console.log(err))