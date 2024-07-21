const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ownerId = process.env.OWNER_ID;
const ownerId2 = process.env.OWNER_ID2;

mongoose.connect(process.env.MONGODB_URI);

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
    await ctx.telegram.sendMessage(
      userId,
      'Welcome to the CC Coin Community! 🚀\n\n\
\
We\'re thrilled to have you on board. Here’s how you can get started and make the most out of CC Coin:\n\n\
\
First step is to Join our Channel; Join and click try again 👇',
      Markup.inlineKeyboard(buttons)
    );
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
  let welcomeMessage = 'hello ';
  
  let channelsToJoin = [];
  const referralToken = ctx.startPayload ? ctx.startPayload.split('_')[1] : null;

  const telegramId = ctx.from.id;
  const name = ctx.from.first_name;

  let user = await User.findOne({ telegramId });

  if (!user) {
    user = new User({ name, telegramId, invitedUsers: 0, image: "ccoin" });
    await user.save();
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

    await ctx.reply(welcomeMessage, Markup.inlineKeyboard(buttons));
  } else {
    await ctx.reply('Welcome to CC Coin! 🎉✨\n\n\
\
We\'re thrilled to have you with us. Here’s what you can do next:\n\n\
\
🚀 Get Started: Explore the amazing features and start earning CC COINS (CCs) right away!\n\n\
\
🌐 Join Our Web App: Access all our exclusive features and manage your CCs efficiently by joining our web app. Simply click the button below!\n\n\
\
💬 Connect with the Community: Engage with fellow users, share tips, and stay updated with the latest news.\n\n\
\
🏅 Unlock Rewards: Participate in events, complete challenges, and earn exciting rewards. The adventure has just begun!\n\n\
Tap the button below to join our web app and start your journey with CC COIN. Happy earning!',Markup.inlineKeyboard([
      Markup.button.url('Launch app','http://t.me/CC_Coin_Farm_Bot/CC_COIN?startapp='+telegramId)
   
    ]));

  }
});


bot.command('add', async (ctx) => {
  if (ctx.from.id.toString() === ownerId || ctx.from.id.toString() === ownerId2) {
    const channelCount = await Channel.countDocuments();
    if (channelCount < 2) {
      await ctx.reply('Press the button below to add a new channel.', Markup.inlineKeyboard([
        Markup.button.callback('Add Channel', 'add_channel')
      ]));
    } else {
      await ctx.reply('You already have 2 channels. The first one will be replaced when you add a new channel.', Markup.inlineKeyboard([
        Markup.button.callback('Add Channel', 'add_channel')
      ]));
    }
  }
});

bot.action('add_channel', async (ctx) => {
  await ctx.reply('Please send the channel username to add (without @):');
  awaitingChannelName = true;
});

bot.on('text', async (ctx) => {
  if (awaitingChannelName) {
    const username = ctx.message.text.trim();
    awaitingChannelName = false;
    try {
      const chat = await ctx.telegram.getChat(`@${username}`);
      if (chat.type === 'channel') {
        await ctx.reply(`Are you sure you want to add @${username} to the required channels?`, Markup.inlineKeyboard([
          Markup.button.callback('Yes', `confirm_add_${username}`),
          Markup.button.callback('No', 'cancel')
        ]));
      } else {
        await ctx.reply('This is not a valid channel.');
      }
    } catch (error) {
      if (error.response && error.response.error_code === 400) {
        await ctx.reply('This is not a valid channel.');
      } else {
        await ctx.reply('An error occurred while trying to add the channel. Please make sure the bot is an admin of the channel and try again.');
      }
      console.error('Error fetching chat:', error);
    }
  }
});

bot.action(/confirm_add_(.+)/, async (ctx) => {
  const channel = ctx.match[1];
  const channelCount = await Channel.countDocuments();

  try {
    if (channelCount < 2) {
      const newChannel = new Channel({ name: channel });
      await newChannel.save();
    } else {
      const oldestChannel = await Channel.findOne().sort({ addedAt: 1 });
      if (oldestChannel) {
        await Channel.deleteOne({ _id: oldestChannel._id });
        const newChannel = new Channel({ name: channel });
        await newChannel.save();
      }
    }
    await ctx.reply(`Channel @${channel} has been added.`);
  } catch (error) {
    if (error.code === 11000) {
      await ctx.reply(`Channel @${channel} already exists.`);
    } else {
      console.error('Error adding channel:', error);
      await ctx.reply('An error occurred while trying to add the channel. Please try again.');
    }
  }
  await ctx.deleteMessage();
});

bot.action('cancel', async (ctx) => {
  await ctx.reply('Action canceled.');
  await ctx.deleteMessage();
});

bot.launch();
