const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ownerId = process.env.OWNER_ID;
const ownerId2 = process.env.OWNER_ID2;

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  name: String,
  points: {
    type: Number,
    default: 10000,
  },
  image: String,
  telegramId: {
    type: String,
    unique: true,
    required: true,
  },
  invitedUsers: {
    type: Number,
    default: 0,
  },
  referredUsers: [{
    type: String,
  }],
});

const User = mongoose.model('User', userSchema);

const channelSchema = new mongoose.Schema({
  name: {
    type: String,
    unique: true,
    required: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

const Channel = mongoose.model('Channel', channelSchema);

let awaitingChannelName = false;
let joinedChannels = new Map();

const checkAndPromptUser = async (ctx, userId) => {
  let allJoined = true;
  let channelsToJoin = [];

  const forcedChannels = await Channel.find({}).sort({ addedAt: 1 });

  for (const channel of forcedChannels) {
    if (!joinedChannels.has(userId) || !joinedChannels.get(userId).has(channel.name)) {
      try {
        const chatMember = await ctx.telegram.getChatMember(`@${channel.name}`, userId);
        if (!['member', 'administrator', 'creator'].includes(chatMember.status)) {
          channelsToJoin.push(channel.name);
          allJoined = false;
        } else {
          if (!joinedChannels.has(userId)) {
            joinedChannels.set(userId, new Set());
          }
          joinedChannels.get(userId).add(channel.name);
        }
      } catch (error) {
        console.error('Error checking membership:', error);
        channelsToJoin.push(channel.name);
        allJoined = false;
      }
    }
  }

  if (!allJoined) {
    const buttons = channelsToJoin.map(channel => [Markup.button.url(`Join community`, `https://t.me/${channel}`)]);
    buttons.push([Markup.button.url('Try again', 'https://t.me/CC_Coin_Farm_Bot?start=start')]);
    try {
      await ctx.telegram.sendMessage(
        userId,
        'Welcome to the CC Coin Community! 🚀\n\n\
First step is to Join our Channel; Join and click try again 👇',
        Markup.inlineKeyboard(buttons)
      );
    } catch (error) {
      if (error.response && error.response.error_code === 403) {
        console.error('User blocked the bot:', userId);
      } else {
        console.error('Error sending join prompt:', error);
      }
    }
  }

  return allJoined;
};

const forceJoinMiddleware = async (ctx, next) => {
  if (ctx.from) {
    const userId = ctx.from.id;
    const hasJoined = await checkAndPromptUser(ctx, userId);
    if (hasJoined) {
      await next();
    }
  } else {
    await next();
  }
};

bot.use(forceJoinMiddleware);

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  let welcomeMessage = 'Hello ';
  
  let channelsToJoin = [];
  const referralToken = ctx.startPayload ? ctx.startPayload.split('_')[1] : null;

  const telegramId = ctx.from.id;
  const name = ctx.from.first_name;


  let user = await User.findOne({ telegramId });

  if (!user) {
    try {
      user = new User({ name, telegramId, invitedUsers: 0, image: "ccoin" });
      await user.save();
    } catch (error) {
      if (error.code === 11000) { 
        console.error('Duplicate key error: User already exists with this telegramId');
      } else {
        console.error('Error saving user:', error);
      }
    }
  }

  if (referralToken && referralToken !== telegramId.toString()) {
    const referrer = await User.findOne({ telegramId: referralToken });
    if (referrer && !referrer.referredUsers.includes(telegramId.toString())) {
      referrer.points += 600;
      referrer.invitedUsers += 1;
      referrer.referredUsers.push(telegramId.toString());
      await referrer.save();
    }
  }
  
  const forcedChannels = await Channel.find({}).sort({ addedAt: 1 });

  for (const channel of forcedChannels) {
    if (!joinedChannels.has(userId) || !joinedChannels.get(userId).has(channel.name)) {
      channelsToJoin.push(channel.name);
    }
  }

  if (channelsToJoin.length > 0) {
    welcomeMessage += '\nYou need to join the following channels:';
    channelsToJoin.forEach(channel => {
      welcomeMessage += `\n- @${channel}`;
    });

    const buttons = channelsToJoin.map(channel => [Markup.button.url(`Join community`, `https://t.me/${channel}`)]);

    try {
      await ctx.reply(welcomeMessage, Markup.inlineKeyboard(buttons));
    } catch (error) {
      console.error('Error sending welcome message with channels:', error);
    }
  } else {
    try {
      await ctx.reply('Welcome to CC Coin! 🎉✨\n\n\
🚀 Get Started: Explore the amazing features and start earning CC COINS (CCs) right away!\n\n\
🌐 Join Our Web App: Access all our exclusive features and manage your CCs efficiently by joining our web app. Simply click the button below!\n\n\
💬 Connect with the Community: Engage with fellow users, share tips, and stay updated with the latest news.\n\n\
🏅 Unlock Rewards: Participate in events, complete challenges, and earn exciting rewards. The adventure has just begun!\n\n\
Tap the button below to get started:', Markup.inlineKeyboard([
        Markup.button.url('Join our web app', 'https://t.me/CC_Coin_Farm_Bot?start=start'),
        Markup.button.url('Our Community', 'https://t.me/CoinCommunityNews')
      ]));
    } catch (error) {
      console.error('Error sending welcome message:', error);
    }
  }
});

bot.command('addchannel', async (ctx) => {
  if (ctx.message.from.id.toString() === ownerId || ctx.message.from.id.toString() === ownerId2) {
    awaitingChannelName = true;
    await ctx.reply('Please send the channel username (without @) that you want to force users to join.');
  }
});

bot.on('text', async (ctx) => {
  if (awaitingChannelName) {
    awaitingChannelName = false;
    const channel = new Channel({ name: ctx.message.text });
    try {
      await channel.save();
      await ctx.reply(`Channel @${ctx.message.text} added successfully!`);
    } catch (error) {
      if (error.code === 11000) {
        await ctx.reply(`Channel @${ctx.message.text} is already in the list.`);
      } else {
        await ctx.reply('An error occurred while adding the channel.');
      }
      console.error('Error saving channel:', error);
    }
  }
});

bot.launch().then(() => {
  console.log('Bot is running');
}).catch((error) => {
  console.error('Error launching bot:', error);
});


const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
