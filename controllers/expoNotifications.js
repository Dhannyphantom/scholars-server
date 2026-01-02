const { Expo } = require("expo-server-sdk");

module.exports = async (tokens, notification) => {
  const expo = new Expo({
    accessToken: process.env.EXPO_ACCESS_TOKEN,
    useFcmV1: true,
  });

  const messages = tokens.filter(Expo.isExpoPushToken).map((token) => ({
    to: token,
    sound: "default",
    title: notification.title,
    body: notification.message,
    data: notification.data || {},
    richContent: {
      image: notification.image || "",
    },
    android: {
      channelId: notification?.data?.channel ?? "General",
    },
  }));

  const chunks = expo.chunkPushNotifications(messages);

  for (const chunk of chunks) {
    await expo.sendPushNotificationsAsync(chunk);
  }
};
