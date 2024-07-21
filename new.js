const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ownerId = process.env.OWNER_ID;
const ownerId2 = process.env.OWNER_ID2;

const botId = process.env.BOT_ID || null;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  name: String,
  points: { type: Number, default: 10000 },
  image: String,
  telegramId: { type: String, unique: true, required: true },
  invitedUsers: { type: Number, default: 0 },
  referredUsers: [{ type: String }],
});

const User = mongoose.model('User', userSchema);

const channelSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  addedAt: { type: Date, default: Date.now },
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
        if (error.response && error.response.error_code === 400 && error.response.description.includes('Bad Request: member list is inaccessible')) {
          console.error('Membership list is inaccessible for channel:', channel.name);
          channelsToJoin.push(channel.name);
          allJoined = false;
        } else if (error.response && error.response.error_code === 403 && error.response.description.includes('Forbidden: bot was blocked by the user')) {
          console.warn('Bot was blocked by the user:', userId);
        } else {
          console.error('Error checking membership:', error);
          channelsToJoin.push(channel.name);
          allJoined = false;
        }
      }
    }
  }

  if (!allJoined) {
    const buttons = channelsToJoin.map(channel => [Markup.button.url('Join community', `https://t.me/${channel}`)]);
    buttons.push([Markup.button.url('Try again', 'https://t.me/CC_Coin_Farm_Bot?start=start')]);
    try {
      await ctx.telegram.sendMessage(
        userId,
        'Welcome to the CC Coin Community! 🚀\n\nFirst step is to Join our Channel; Join and click try again 👇',
        Markup.inlineKeyboard(buttons)
      );
    } catch (error) {
      console.error('Error sending join prompt:', error);
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
  let welcomeMessage = 'hello ';

  let channelsToJoin = [];
  const referralToken = ctx.startPayload ? ctx.startPayload.split('_')[1] : null;

  const telegramId = ctx.from.id;
  const name = ctx.from.first_name;
  const image = 'coin'; 
  invitedUsers=0;
  let user;
  try {
    user = await User.findOneAndUpdate(
      { telegramId },
      { name, image,invitedUsers},
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    console.error('Error creating or finding user:', error);
    return ctx.reply('An error occurred while processing your request. Please try again later.');
  }

  if (referralToken && referralToken !== telegramId.toString()) {
    try {
      const referrer = await User.findOne({ telegramId: referralToken });
      if (referrer && !referrer.referredUsers.includes(telegramId.toString())) {
        referrer.points += 600;
        referrer.invitedUsers += 1;
        referrer.referredUsers.push(telegramId.toString());
        await referrer.save();
      }
    } catch (error) {
      console.error('Error processing referral:', error);
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

    const buttons = channelsToJoin.map(channel => [Markup.button.url('Join community', `https://t.me/${channel}`)]);

    try {
      await ctx.reply(welcomeMessage, Markup.inlineKeyboard(buttons));
    } catch (error) {
      console.error('Error sending welcome message:', error);
    }
  } else {
    try {
      await ctx.reply('Welcome to CC Coin! 🎉✨\n\n\
We\'re thrilled to have you with us. Here’s what you can do next:\n\n\
🚀 Get Started: Explore the amazing features and start earning CC COINS (CCs) right away!\n\n\
🌐 Join Our Web App: Access all our exclusive features and manage your CCs efficiently by joining our web app. Simply click the button below!\n\n\
💬 Connect with the Community: Engage with fellow users, share tips, and stay updated with the latest news.\n\n\
🏅 Unlock Rewards: Participate in events, complete challenges, and earn exciting rewards. The adventure has just begun!\n\n\
Tap the button below to join our web app and start your journey with CC COIN. Happy earning!', Markup.inlineKeyboard([
        Markup.button.url('Launch app', 'http://t.me/CC_Coin_Farm_Bot/CC_COIN?startapp=' + telegramId)
      ]));
    } catch (error) {
      console.error('Error sending welcome message:', error);
    }
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
        try {
          if (botId) {
            const botStatus = await ctx.telegram.getChatMember(`@${username}`, botId);
            if (botStatus.status === 'administrator' || botStatus.status === 'creator') {
              await ctx.reply(`Are you sure you want to add @${username} to the required channels?`, Markup.inlineKeyboard([
                Markup.button.callback('Yes', `confirm_add_${username}`),
                Markup.button.callback('No', 'cancel')
              ]));
            } else {
              await ctx.reply('The bot must be an admin in the channel to add it.');
            }
          } else {
            await ctx.reply('Bot ID is not set. Please configure the bot ID.');
          }
        } catch (error) {
          if (error.response && error.response.error_code === 400 && error.response.description.includes('Bad Request: invalid user_id specified')) {
            await ctx.reply('An error occurred while checking the bot\'s admin status. The bot ID might be incorrect.');
            console.error('Invalid bot ID:', error);
          } else {
            await ctx.reply('An error occurred while trying to add the channel. Please ensure the bot is an admin and try again.');
            console.error('Error checking bot admin status:', error);
          }
        }
      } else {
        await ctx.reply('This is not a valid channel.');
      }
    } catch (error) {
      if (error.response && error.response.error_code === 400) {
        await ctx.reply('This is not a valid channel.');
      } else {
        await ctx.reply('An error occurred while trying to add the channel. Please make sure the channel is valid and try again.');
      }
      console.error('Error fetching chat:', error);
    }
  }
});

bot.action(/confirm_add_(.+)/, async (ctx) => {
  const channelName = ctx.match[1];
  const newChannel = new Channel({ name: channelName });
  try {
    await newChannel.save();
    await ctx.reply(`Channel @${channelName} added successfully.`);
  } catch (error) {
    await ctx.reply('An error occurred while adding the channel.');
    console.error('Error saving channel:', error);
  }
});

bot.action('cancel', async (ctx) => {
  awaitingChannelName = false;
  await ctx.reply('Channel addition canceled.');
});

bot.launch({

});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running');
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server listening on port ${process.env.PORT || 3000}`);
});
