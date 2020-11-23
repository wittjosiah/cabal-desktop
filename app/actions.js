import { homedir } from 'os'
import { decode, encode } from 'dat-encoding'
import { ipcRenderer } from 'electron'
import Client from 'cabal-client'
import fs from 'fs'
import path from 'path'
import moment from 'moment'
import remark from 'remark'
import remarkEmoji from 'remark-emoji'
import remarkReact from 'remark-react'
import throttle from 'lodash.throttle'
const { dialog } = require('electron').remote
const User = require('cabal-client/src/user')

var remarkAltProt = require('remark-altprot')
var merge = require('deepmerge')
var gh = require('hast-util-sanitize/lib/github')
var cabalSanitize = {
  sanitize: merge(gh, { protocols: { href: ['hyper', 'dat', 'cabal','hypergraph','hypermerge'] } })
}

const DEFAULT_CHANNEL = 'default'
const HOME_DIR = homedir()
const DATA_DIR = path.join(HOME_DIR, '.cabal-desktop', `v${Client.getDatabaseVersion()}`)
const STATE_FILE = path.join(DATA_DIR, 'cabals.json')
const DEFAULT_PAGE_SIZE = 100
const MAX_FEEDS = 1000

const client = new Client({
  maxFeeds: MAX_FEEDS,
  config: {
    dbdir: DATA_DIR
  },
  commands: {
    help: {
      help: () => 'display this help message',
      call: (cabal, res, arg) => {
        const commands = client.getCommands()
        let helpContent = ''
        for (var key in commands) {
          helpContent = helpContent + `/${key} - ${commands[key].help()} \n`
        }
        addStatusMessage({ addr: cabal.key, text: helpContent })
      }
    }
  }
})
// Disable a few slash commands for now
const removedCommands = ['add', 'channels', 'clear', 'ids', 'names', 'new', 'qr', 'whoami', 'whois']
removedCommands.forEach((command) => {
  client.removeCommand(command)
})

// On exit, close the cabals to cleanly leave the hyperswarms
window.onbeforeunload = (e) => {
  for (let cabal of client.cabals.values()) {
    cabal._destroy(() => {})
  }
}

export const viewCabal = ({ addr, channel, skipScreenHistory }) => dispatch => {
  client.focusCabal(addr)
  channel = channel || client.getCurrentChannel()
  dispatch({ addr, channel, type: 'VIEW_CABAL' })
  dispatch(viewChannel({ addr, channel, skipScreenHistory }))
}

export const showProfilePanel = ({ addr, userKey }) => (dispatch) => {
  dispatch(hideChannelPanel({ addr }))
  dispatch({ type: 'SHOW_PROFILE_PANEL', addr, userKey })
}

export const hideProfilePanel = ({ addr }) => (dispatch) => {
  dispatch({ type: 'HIDE_PROFILE_PANEL', addr })
}

export const showChannelPanel = ({ addr }) => (dispatch) => {
  dispatch(hideProfilePanel({ addr }))
  dispatch({ type: 'SHOW_CHANNEL_PANEL', addr })
}

export const hideChannelPanel = ({ addr }) => (dispatch) => {
  dispatch({ type: 'HIDE_CHANNEL_PANEL', addr })
}

export const updateScreenViewHistory = ({ addr, channel }) => (dispatch) => {
  dispatch({ type: 'UPDATE_SCREEN_VIEW_HISTORY', addr, channel })
}

export const setScreenViewHistoryPostion = ({ index }) => (dispatch) => {
  dispatch({ type: 'SET_SCREEN_VIEW_HISTORY_POSITION', index })
}

export const showChannelBrowser = ({ addr }) => dispatch => {
  const cabalDetails = client.getDetails(addr)

  const channels = Object.values(cabalDetails.channels)
  const sensorChannels = Object.values(cabalDetails.sensorChannels)

  const channelsData =
   channels
     .concat(sensorChannels)
     .map((channel) => {
       return {
         joined: channel.joined,
         memberCount: channel.members.size,
         name: channel.name,
         topic: channel.topic
       }
     })

  dispatch({ type: 'UPDATE_CHANNEL_BROWSER', addr, channelsData })
  dispatch(hideAllModals())
  dispatch({ type: 'SHOW_CHANNEL_BROWSER', addr })
}

export const showCabalSettings = ({ addr }) => dispatch => {
  dispatch(hideAllModals())
  dispatch({ type: 'SHOW_CABAL_SETTINGS', addr })
}

export const hideCabalSettings = () => dispatch => {
  dispatch({ type: 'HIDE_CABAL_SETTINGS' })
}

export const hideAllModals = () => dispatch => {
  dispatch({ type: 'HIDE_ALL_MODALS' })
}

export const restoreCabalSettings = ({ addr, settings }) => dispatch => {
  dispatch({ type: 'UPDATE_CABAL_SETTINGS', addr, settings })
}

export const saveCabalSettings = ({ addr, settings }) => dispatch => {
  dispatch({ type: 'UPDATE_CABAL_SETTINGS', addr, settings })
  dispatch(storeOnDisk())
}

export const removeCabal = ({ addr }) => dispatch => {
  dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Remove'],
    message: `Are you sure you want to remove this cabal (${addr.substr(0, 8)}...) from Cabal Desktop?`
  }).then((response) => {
    if (response.response === 1) {
      dispatch(confirmRemoveCabal({ addr }))
    }
  })
}

// remove cabal
export const confirmRemoveCabal = ({ addr }) => async dispatch => {
  client.removeCabal(addr)
  dispatch({ type: 'DELETE_CABAL', addr })
  // update the local file to reflect while restarting the app
  dispatch(storeOnDisk())
  const allCabals = client.getCabalKeys()

  // switch to the first cabal, else in case of no remaning cabals
  // show the add-cabal screen
  if (allCabals.length) {
    const toCabal = allCabals[0]
    client.focusCabal(toCabal)
    const cabalDetails = client.getDetails(toCabal)
    dispatch({
      addr: toCabal,
      channel: cabalDetails.getCurrentChannel(),
      type: 'VIEW_CABAL'
    })
  } else {
    dispatch({ type: 'CHANGE_SCREEN', screen: 'addCabal' })
  }
  dispatch(hideAllModals())
}

export const listCommands = () => dispatch => {
  return client.getCommands()
}

export const joinChannel = ({ addr, channel }) => dispatch => {
  if (channel.length > 0) {
    const cabalDetails = client.getDetails(addr)
    cabalDetails.joinChannel(channel)
    dispatch(addChannel({ addr, channel }))
    dispatch(viewChannel({ addr, channel }))
  }
}

export const leaveChannel = ({ addr, channel }) => dispatch => {
  const currentChannel = client.getCurrentChannel()
  if (!channel || !channel.length) {
    channel = currentChannel
  }
  if (channel === currentChannel) {
    dispatch(viewNextChannel({ addr }))
  }
  const cabalDetails = client.getDetails(addr)
  cabalDetails.leaveChannel(channel)
}

export const viewNextChannel = ({ addr }) => dispatch => {
  const cabalDetails = client.getDetails(addr)
  const channels = cabalDetails.getJoinedChannels()
  if (channels.length) {
    let index = channels.findIndex((channel) => channel === client.getCurrentChannel()) + 1
    if (index > channels.length - 1) {
      index = 0
    }
    dispatch(viewChannel({ addr, channel: channels[index] }))
  }
}

export const viewPreviousChannel = ({ addr }) => dispatch => {
  const cabalDetails = client.getDetails(addr)
  const channels = cabalDetails.getJoinedChannels()
  if (channels.length) {
    let index = channels.findIndex((channel) => channel === client.getCurrentChannel()) - 1
    if (index < 0) {
      index = channels.length - 1
    }
    dispatch(viewChannel({ addr, channel: channels[index] }))
  }
}

export const setUsername = ({ username, addr }) => dispatch => {
  const cabalDetails = client.getDetails(addr)
  const currentUsername = cabalDetails.getLocalName()
  if (username !== currentUsername) {
    cabalDetails.publishNick(username, () => {
      dispatch({ type: 'UPDATE_CABAL', addr: cabalDetails.key, username })
      addStatusMessage({
        addr: cabalDetails.key,
        channel: cabalDetails.getCurrentChannel(),
        text: `Nick set to: ${username}`
      })
    })
  }
}

const enrichMessage = (message) => {
  return Object.assign({}, message, {
    enriched: {
      time: message.time,
      content: remark().use(remarkAltProt).use(remarkReact, cabalSanitize).use(remarkEmoji).processSync(message.content).result
    }
  })
}

export const getMessages = ({ addr, channel, amount }, callback) => dispatch => {
  client.focusCabal(addr)
  const cabalDetails = client.getDetails(addr)
  if (client.getChannels().includes(channel)) {
    client.getMessages({ amount, channel }, (messages) => {
      messages = messages.map((message) => {
        const user = dispatch(getUser({ key: message.key }))
        const { type, timestamp, content } = message.value
        return enrichMessage({
          content: content && content.text,
          key: message.key,
          message,
          time: timestamp,
          type,
          user
        })
      })
      dispatch({ type: 'UPDATE_CABAL', addr, messages })
      if (callback) {
        callback(messages)
      }
    })
  }
}

export const getSensors = ({ addr, amount, channel }, callback) => dispatch => {
  client.focusCabal(addr)
  const cabalDetails = client.getDetails(addr)
  if (client.getChannels().includes(channel)) {
    cabalDetails.getSensorMessages({ amount, channel }).then((sensorMessages) => {
      const groupedMessages = sensorMessages.reduce((acc, msg) => {
        const point = msg.value.content

        for (const field in point.fields) {
          const fieldData = acc[field] || {}
          const points = fieldData[point.deviceId] || []
          points.unshift({ x: new Date(msg.value.timestamp), y: point.fields[field] })
          fieldData[point.deviceId] = points
          acc[field] = fieldData
        }

        return acc
      }, {})

      const parsedMessages = {}
      for (const field in groupedMessages) {
        const data = []
        for (const device in groupedMessages[field]) {
          data.push({ id: device, data: groupedMessages[field][device] })
        }
        parsedMessages[field] = data
      }

      dispatch({ type: 'UPDATE_CABAL', addr, sensorMessages: parsedMessages})

      if (callback) {
        callback(parsedMessages)
      }
    })
  }
}

export const onIncomingMessage = ({ addr, channel, message }, callback) => (dispatch, getState) => {
  const cabalDetails = client.getDetails(addr)

  // Ignore incoming message from channels you're not in
  if (!cabalDetails.getJoinedChannels().includes(channel)) return

  const user = dispatch(getUser({ key: message.key }))

  // Ignore incoming messages from hidden users
  if (user && user.isHidden()) return

  // Add incoming message to message list if you're viewing that channel
  const currentChannel = cabalDetails.getCurrentChannel()
  if ((channel === currentChannel) && (addr === client.getCurrentCabal().key)) {
    const { type, timestamp, content } = message.value
    const enrichedMessage = enrichMessage({
      content: content && content.text,
      key: message.key,
      message,
      time: timestamp,
      type,
      user
    })
    const messages = [
      ...getState()?.cabals[addr].messages,
      enrichedMessage
    ]
    dispatch({ type: 'UPDATE_CABAL', addr, messages })
  } else {
    // Skip adding to message list if not viewing that channel, instead update unread count
    dispatch(updateUnreadCounts({ addr }))
  }

  const settings = getState().cabalSettings[addr]
  if (!!settings.enableNotifications && !document.hasFocus()) {
    dispatch(sendDesktopNotification({
      addr,
      user,
      channel,
      content: message.value.content
    }))
  }
}

export const onIncomingSensor = ({ addr, channel, message }, callback) => (dispatch, getState) => {
  const cabalDetails = client.getDetails(addr)

  if (!cabalDetails.getJoinedChannels().includes(channel)) return

  const currentChannel = cabalDetails.getCurrentChannel()

  if ((channel === currentChannel) && (addr === client.getCurrentCabal().key)) {
    const sensorMessages = getState()?.cabals[addr].sensorMessages
    const { deviceId, fields } = message.value.content
    const timestamp = message.value.timestamp

    for (const field in fields) {
      const deviceMessages = sensorMessages[field].find(({ id }) => id === deviceId)
      const point = { x: new Date(timestamp), y: fields[field] }

      if (deviceMessages) {
        deviceMessages.data.unshift(point)
      } else {
        sensorMessages[field].push({ id: deviceId, data: [point] })
      }
    }

    dispatch({ type: 'UPDATE_CABAL', addr, sensorMessages })
  }
}

export const getUsers = () => (dispatch) => {
  const cabalDetails = client.getCurrentCabal()
  return cabalDetails.getUsers()
}

export const getUser = ({ key }) => (dispatch) => {
  const cabalDetails = client.getCurrentCabal()
  const users = cabalDetails.getUsers()
  // TODO: This should be inside cabalDetails.getUser(...)
  var user = users[key]
  if (!user) user = new User({
    name: key.substr(0, 6),
    key: key
  })
  if (!user.name) user.name = key.substr(0,6)

  return user
}

export const viewChannel = ({ addr, channel, skipScreenHistory }) => (dispatch, getState) => {
  if (!channel || channel.length === 0) return

  if (client.getChannels().includes(channel)) {
    client.focusChannel(channel)
    client.markChannelRead(channel)
  } else {
    dispatch(joinChannel({ addr, channel }))
  }

  const cabalDetails = client.getCurrentCabal()
  const channelMessagesUnread = getCabalUnreadMessagesCount(cabalDetails)

  dispatch(hideAllModals())
  dispatch({
    addr,
    channel: cabalDetails.getCurrentChannel(),
    channels: cabalDetails.getChannels(),
    channelsJoined: cabalDetails.getJoinedChannels(),
    channelMessagesUnread,
    type: 'ADD_CABAL',
    username: cabalDetails.getLocalName(),
    users: cabalDetails.getUsers()
  })
  dispatch({
    type: 'VIEW_CABAL',
    addr,
    channel: cabalDetails.getCurrentChannel()
  })
  dispatch(getMessages({ addr, channel, amount: 100 }))
  dispatch(getSensors({ addr, channel, amount: 1000 }))

  const topic = cabalDetails.getTopic()
  dispatch({ type: 'UPDATE_TOPIC', addr, topic })
  dispatch(updateChannelMessagesUnread({ addr, channel, unreadCount: 0 }))

  // When a user is walking through history by using screen history navigation commands,
  // `skipScreenHistory=true` does not add that navigation event to the end of the history
  // stack so that navigating again forward through history works.
  if (!skipScreenHistory) {
    dispatch(updateScreenViewHistory({ addr, channel }))
  }

  dispatch(saveCabalSettings({ addr, settings: { currentChannel: channel } }))
}

export const changeScreen = ({ screen, addr }) => ({ type: 'CHANGE_SCREEN', screen, addr })

export const addCabal = ({ addr, isNewlyAdded, settings, username }) => async (dispatch) => {
  if (addr) {
    // Convert domain keys to cabal keys
    addr = await client.resolveName(addr)
  }
  if (client._keyToCabal[addr]) {
    // Show cabal if already added to client
    dispatch(viewCabal({ addr }))
    if (username) {
      dispatch(setUsername({ addr, username }))
    }
    return
  } else {
    // Add the cabal to the client using the default per cabal user settings
    settings = {
      alias: '',
      enableNotifications: false,
      currentChannel: DEFAULT_CHANNEL,
      ...settings
    }
    dispatch(initializeCabal({ addr, isNewlyAdded, settings, username }))
  }
}

export const sendDesktopNotification = throttle(({ addr, user, channel, content }) => (dispatch) => {
  window.Notification.requestPermission()
  const notification = new window.Notification(user.name, {
    body: content.text
  })
  notification.onclick = () => {
    dispatch(viewCabal({ addr, channel }))
  }
}, 5000, { leading: true, trailing: true })

export const addChannel = ({ addr, channel }) => (dispatch, getState) => {
  dispatch(hideAllModals())
  const cabalDetails = client.getCurrentCabal()

  client.focusChannel(channel)
  const topic = cabalDetails.getTopic()

  const opts = {}
  opts.newerThan = opts.newerThan || null
  opts.olderThan = opts.olderThan || Date.now()
  opts.amount = opts.amount || DEFAULT_PAGE_SIZE * 2.5

  client.getMessages(opts, (messages) => {
    messages = messages.map((message) => {
      const { type, timestamp, content = {} } = message.value
      const user = dispatch(getUser({ key: message.key }))

      const settings = getState().cabalSettings[addr]
      if (!!settings.enableNotifications && !document.hasFocus()) {
        dispatch(sendDesktopNotification({ addr, user, channel, content }))
      }

      return enrichMessage({
        content: content.text,
        key: message.key,
        message,
        time: timestamp,
        type,
        user
      })
    })
    if (cabalDetails.getCurrentChannel() === channel) {
      dispatch({ type: 'UPDATE_CABAL', addr, messages, topic })
    }
  })
}

export const processLine = ({ message, addr }) => dispatch => {
  const text = message.content.text
  if (text.startsWith('/')) {
    const cabal = client.getCurrentCabal()
    cabal.processLine(text)
  } else {
    dispatch(addMessage({ message, addr }))
  }
}

export const addMessage = ({ message, addr }) => dispatch => {
  const cabalDetails = client.getDetails(addr)
  cabalDetails.publishMessage(message)
}

export const addStatusMessage = ({ addr, channel, text }) => {
  const cabalDetails = addr ? client.getDetails(addr) : client.getCurrentCabal()
  client.addStatusMessage({ text }, channel, cabalDetails._cabal)
}

export const setChannelTopic = ({ topic, channel, addr }) => dispatch => {
  const cabalDetails = client.getDetails(addr)
  cabalDetails.publishChannelTopic(channel, topic)
  dispatch({ type: 'UPDATE_TOPIC', addr, topic })
  addStatusMessage({
    addr,
    channel,
    text: `Topic set to: ${topic}`
  })
}

export const updateChannelMessagesUnread = ({ addr, channel, unreadCount }) => (dispatch, getState) => {
  const cabals = getState().cabals || {}
  const cabal = cabals[addr] || {}
  const channelMessagesUnread = getState().cabals[addr].channelMessagesUnread || {}
  if (unreadCount !== undefined) {
    channelMessagesUnread[channel] = unreadCount
  } else {
    channelMessagesUnread[channel] = (cabal.channelMessagesUnread && cabal.channelMessagesUnread[channel]) || 0
  }
  dispatch({ type: 'UPDATE_CABAL', addr, channelMessagesUnread })
  dispatch(updateAllsChannelsUnreadCount({ addr, channelMessagesUnread }))
}

export const updateAllsChannelsUnreadCount = ({ addr, channelMessagesUnread }) => (dispatch, getState) => {
  const allChannelsUnreadCount = Object.values(channelMessagesUnread).reduce((total, value) => {
    return total + (value || 0)
  }, 0)
  if (allChannelsUnreadCount !== getState()?.cabals[addr]?.allChannelsUnreadCount) {
    dispatch({ type: 'UPDATE_CABAL', addr, allChannelsUnreadCount, channelMessagesUnread })
    dispatch(updateAppIconBadge())
  }
}

export const updateUnreadCounts = ({ addr }) => (dispatch) => {
  const cabalDetails = client.getDetails(addr)
  const channelMessagesUnread = getCabalUnreadMessagesCount(cabalDetails)
  dispatch(updateAllsChannelsUnreadCount({ addr, channelMessagesUnread }))
}

export const updateAppIconBadge = (badgeCount) => (dispatch, getState) => {
  // TODO: if (!!app.settings.enableBadgeCount) {
  const cabals = getState().cabals || {}
  badgeCount = badgeCount || Object.values(cabals).reduce((total, cabal) => {
    return total + (cabal.allChannelsUnreadCount || 0)
  }, 0)
  ipcRenderer.send('update-badge', { badgeCount, showCount: false }) // TODO: app.settings.showBadgeCountNumber
  dispatch({ type: 'UPDATE_WINDOW_BADGE', badgeCount })
}

export const showEmojiPicker = () => dispatch => {
  dispatch({ type: 'SHOW_EMOJI_PICKER' })
}

export const hideEmojiPicker = () => dispatch => {
  dispatch({ type: 'HIDE_EMOJI_PICKER' })
}

const getCabalUnreadMessagesCount = (cabalDetails) => {
  const cabalCore = client._keyToCabal[cabalDetails.key]
  const channelMessagesUnread = {}
  // fetch unread message count only for joined channels.
  cabalDetails.getJoinedChannels().map((channel) => {
    channelMessagesUnread[channel] = client.getNumberUnreadMessages(channel, cabalCore)
  })
  return channelMessagesUnread
}

const initializeCabal = ({ addr, isNewlyAdded, username, settings }) => async dispatch => {
  const isNew = !addr
  const cabalDetails = isNew ? await client.createCabal() : await client.addCabal(addr)
  addr = cabalDetails.key

  useSensorsView(cabalDetails)
  await useSensorChannelsView(cabalDetails)

  console.log('---> initializeCabal', { addr, settings })

  function initialize () {
    const users = cabalDetails.getUsers()
    const userkey = cabalDetails.getLocalUser().key
    const username = cabalDetails.getLocalName()
    const channels = cabalDetails.getChannels()
    const channelsJoined = cabalDetails.getJoinedChannels() || []
    const channelMessagesUnread = getCabalUnreadMessagesCount(cabalDetails)
    const currentChannel = cabalDetails.getCurrentChannel()
    const channelMembers = cabalDetails.getChannelMembers()
    const sensorChannels = Object.keys(cabalDetails.sensorChannels).sort()

    dispatch({ type: 'UPDATE_CABAL', initialized: false, addr, channelMessagesUnread, users, userkey, username, channels, channelsJoined, currentChannel, channelMembers, sensorChannels })
    dispatch(getMessages({ addr, amount: 1000, channel: currentChannel }))
    dispatch(getSensors({ addr, amount: 1000, channel: currentChannel }))
    dispatch(updateAllsChannelsUnreadCount({ addr, channelMessagesUnread }))
    client.focusCabal(addr)
    dispatch(viewCabal({ addr, channel: settings.currentChannel }))
  }

  const cabalDetailsEvents = [
    {
      name: 'update',
      action: (data) => {
        // console.log('update event', data)
      }
    },
    {
      name: 'cabal-focus',
      action: () => { }
    }, {
      name: 'command',
      action: (data) => {
        console.log('COMMAND', data)
      }
    }, {
      name: 'channel-focus',
      action: () => {
        const channelsJoined = cabalDetails.getJoinedChannels()
        const channelMembers = cabalDetails.getChannelMembers()
        const channelMessagesUnread = getCabalUnreadMessagesCount(cabalDetails)
        const currentChannel = cabalDetails.getCurrentChannel()
        const username = cabalDetails.getLocalName()
        const users = cabalDetails.getUsers()
        dispatch({ type: 'UPDATE_CABAL', addr, channelMembers, channelMessagesUnread, channelsJoined, currentChannel, username, users })
        dispatch(updateAllsChannelsUnreadCount({ addr, channelMessagesUnread }))
      }
    }, {
      name: 'channel-join',
      action: () => {
        const channelMembers = cabalDetails.getChannelMembers()
        const channelMessagesUnread = getCabalUnreadMessagesCount(cabalDetails)
        const channelsJoined = cabalDetails.getJoinedChannels()
        const currentChannel = cabalDetails.getCurrentChannel()
        dispatch({ type: 'UPDATE_CABAL', addr, channelMembers, channelMessagesUnread, channelsJoined, currentChannel })
        dispatch(getMessages({ addr, amount: 1000, channel: currentChannel }))
        dispatch(getSensors({ addr, amount: 1000, channel: currentChannel }))
        dispatch(updateAllsChannelsUnreadCount({ addr, channelMessagesUnread }))
        dispatch(viewChannel({ addr, channel: currentChannel }))
      }
    }, {
      name: 'channel-leave',
      action: (data) => {
        const currentChannel = client.getCurrentChannel()
        const channelMessagesUnread = getCabalUnreadMessagesCount(cabalDetails)
        const channelsJoined = cabalDetails.getJoinedChannels()
        dispatch({ type: 'UPDATE_CABAL', addr, channelMessagesUnread, channelsJoined })
        dispatch(updateAllsChannelsUnreadCount({ addr, channelMessagesUnread }))
        dispatch(viewChannel({ addr, channel: currentChannel }))
      }
    }, {
      name: 'command',
      action: ({ arg, command, data }) => {
        console.warn('command', { arg, command, data })
      }
    }, {
      name: 'info',
      action: (text) => {
        console.log('info', text)
        if (text.startsWith('whispering on')) {
          const currentChannel = client.getCurrentChannel()
          client.addStatusMessage({ text }, currentChannel, cabalDetails._cabal)
        }
      }
    }, {
      name: 'init',
      action: initialize
    }, {
      name: 'new-channel',
      action: () => {
        const channels = cabalDetails.getChannels()
        const channelMembers = cabalDetails.getChannelMembers()
        dispatch({ type: 'UPDATE_CABAL', addr, channels, channelMembers })
      }
    }, {
      name: 'new-sensor',
      throttleDelay: 500,
      action: (data) => {
        const channel = data.channel
        const message = data.message
        dispatch(onIncomingSensor({ addr, channel, message }))
      }
    }, {
      name: 'new-message',
      throttleDelay: 500,
      action: (data) => {
        const channel = data.channel
        const message = data.message
        dispatch(onIncomingMessage({ addr, channel, message }))
      }
    }, {
      name: 'publish-message',
      action: () => {
        const channelMessagesUnread = getCabalUnreadMessagesCount(cabalDetails)
        const currentChannel = cabalDetails.getCurrentChannel()
        dispatch(getMessages({ addr, amount: 1000, channel: currentChannel }))
        dispatch(updateAllsChannelsUnreadCount({ addr, channelMessagesUnread }))
      }
    }, {
      name: 'publish-nick',
      action: () => {
        const users = cabalDetails.getUsers()
        dispatch({ type: 'UPDATE_CABAL', addr, users })
      }
    }, {
      name: 'started-peering',
      throttleDelay: 1000,
      action: () => {
        const users = cabalDetails.getUsers()
        dispatch({ type: 'UPDATE_CABAL', addr, users })
      }
    }, {
      name: 'status-message',
      action: () => {
        const channelMessagesUnread = getCabalUnreadMessagesCount(cabalDetails)
        const currentChannel = cabalDetails.getCurrentChannel()
        dispatch(getMessages({ addr, amount: 1000, channel: currentChannel }))
        dispatch(updateAllsChannelsUnreadCount({ addr, channelMessagesUnread }))
      }
    }, {
      name: 'stopped-peering',
      throttleDelay: 1000,
      action: () => {
        const users = cabalDetails.getUsers()
        dispatch({ type: 'UPDATE_CABAL', addr, users })
      }
    }, {
      name: 'topic',
      action: (data) => {
        const cabal = client.getCurrentCabal()
        const channel = data.channel
        const topic = cabalDetails.getTopic()
        dispatch({ type: 'UPDATE_TOPIC', addr, topic })
        if (addr === cabal.key && channel === cabalDetails.getCurrentChannel()) {
          addStatusMessage({
            addr,
            channel,
            text: `Topic set to: ${topic}`
          })
        }
      }
    }, {
      name: 'user-updated',
      action: (data) => {
        const users = cabalDetails.getUsers()
        dispatch({ type: 'UPDATE_CABAL', addr, users })
        // Update local user
        const cabal = client.getCurrentCabal()
        if (data.key === cabal.getLocalUser().key) {
          const username = data.user?.name
          dispatch({ type: 'UPDATE_CABAL', addr: cabalDetails.key, username })
          addStatusMessage({
            addr: cabalDetails.key,
            channel: cabalDetails.getCurrentChannel(),
            text: `Nick set to: ${username}`
          })
        }
      }
    }
  ]
  setTimeout(() => {
    cabalDetailsEvents.forEach((event) => {
      const action = throttle((data) => {
        // console.log('Event:', event.name, data)
        event.action(data)
      }, event.throttleDelay, { leading: true, trailing: true })
      cabalDetails.on(event.name, action)
    })

    initialize()
    dispatch({ type: 'UPDATE_CABAL', initialized: true, addr })
  }, isNewlyAdded ? 10000 : 0)

  // if creating a new cabal, set a default username.
  if (isNew || username) {
    dispatch(setUsername({ username: username || generateUniqueName(), addr }))
  }
}

export const loadFromDisk = () => async dispatch => {
  let state
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch (_) {
    state = {}
  }
  const stateKeys = Object.keys(state)
  // Restore previous settings state into store before initializing cabals
  stateKeys.forEach((key) => {
    const { addr, settings } = JSON.parse(state[key])
    dispatch(restoreCabalSettings({ addr, settings }))
  })
  // Initialize all of the cabals
  stateKeys.forEach((key) => {
    const { addr, settings } = JSON.parse(state[key])
    dispatch(addCabal({ addr, settings }))
  })
  // if (stateKeys.length) {
  //   setTimeout(() => {
  //     const firstCabal = JSON.parse(state[stateKeys[0]])
  //     dispatch(viewCabal({ addr: firstCabal.addr, channel: firstCabal.settings.currentChannel }))
  //     client.focusCabal(firstCabal.addr)
  //   }, 5000)
  // }
  dispatch({ type: 'CHANGE_SCREEN', screen: stateKeys.length ? 'main' : 'addCabal' })
}

const storeOnDisk = () => (dispatch, getState) => {
  const cabalKeys = client.getCabalKeys()
  const { cabalSettings } = getState()
  let state = {}
  cabalKeys.forEach((addr) => {
    state[addr] = JSON.stringify({
      addr,
      settings: cabalSettings[addr] || {}
    })
  })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

const generateUniqueName = () => {
  const adjectives = ['ancient', 'whispering', 'hidden', 'emerald', 'occult', 'obscure', 'wandering', 'ephemeral', 'eccentric', 'singing']
  const nouns = ['lichen', 'moss', 'shadow', 'stone', 'ghost', 'friend', 'spore', 'fungi', 'mold', 'mountain', 'compost', 'conspirator']

  const randomItem = (array) => array[Math.floor(Math.random() * array.length)]
  return `${randomItem(adjectives)}-${randomItem(nouns)}`
}

export const moderationHide = (props) => async dispatch => {
  dispatch(moderationAction('hide', props))
}

export const moderationUnhide = (props) => async dispatch => {
  dispatch(moderationAction('unhide', props))
}

export const moderationBlock = (props) => async dispatch => {
  dispatch(moderationAction('block', props))
}

export const moderationUnblock = (props) => async dispatch => {
  dispatch(moderationAction('unblock', props))
}

export const moderationAddMod = (props) => async dispatch => {
  dispatch(moderationAction('addMod', props))
}

export const moderationRemoveMod = (props) => async dispatch => {
  dispatch(moderationAction('removeMod', props))
}

export const moderationAddAdmin = (props) => async dispatch => {
  dispatch(moderationAction('addAdmin', props))
}

export const moderationRemoveAdmin = (props) => async dispatch => {
  dispatch(moderationAction('removeAdmin', props))
}

export const moderationAction = (action, { addr, channel, reason, userKey}) => async dispatch => {
  const cabalDetails = client.getDetails(addr)
  await cabalDetails.moderation[action](userKey, { channel, reason })
  setTimeout(() => {
    const users = cabalDetails.getUsers()
    dispatch({ type: 'UPDATE_CABAL', addr, users })
  }, 500)
}

//////////////////
// Sensor Views //
//////////////////

const charwise = require('charwise')
const collect = require('collect-stream')
const EventEmitter = require('events').EventEmitter
const View = require('kappa-view-level')
const timestamp = require('monotonic-timestamp')
const readonly = require('read-only-stream')
const sublevel = require('subleveldown')
const through = require('through2')
const xtend = require('xtend')

const { ChannelDetails } = require('../node_modules/cabal-client/src/channel-details')

const SENSORS = 's'
const SENSOR_CHANNELS = 'sc'

function useSensorsView (cabalDetails) {
  const cabal = cabalDetails._cabal

  cabal.kcore.use('sensors', createSensorsView(sublevel(cabal.db, SENSORS, { valueEncoding: 'json' })))
  cabal.sensors = cabal.kcore.api.sensors

  cabalDetails.getSensorMessages = ({ amount, channel }) => {
    return new Promise((resolve, reject) => {
      const rs = cabal.sensors.read(channel, { limit: amount })
      collect(rs, (err, msgs) => {
        if (err) reject(err)
        resolve(msgs.reverse())
      })
    })
  }
}

async function useSensorChannelsView (cabalDetails) {
  const cabal = cabalDetails._cabal

  cabal.kcore.use(
    'sensorChannels',
    createSensorChannelsView(sublevel(cabal.db, SENSOR_CHANNELS, { valueEncoding: 'json' }))
  )
  cabal.sensorChannels = cabal.kcore.api.sensorChannels

  await new Promise((resolve, reject) => {
    cabal.sensorChannels.get((err, sensorChannels) => {
      if (err) reject(err)

      cabalDetails.sensorChannels = {}

      sensorChannels.forEach((sensorChannel) => {
        const details = cabalDetails.sensorChannels[sensorChannel]
        if (!details) {
          cabalDetails.sensorChannels[sensorChannels] = new ChannelDetails(cabal, sensorChannel)
        }

        cabal.sensors.events.on(sensorChannel, messageListener.bind(cabalDetails))
      })

      resolve()
    })
  })
}

function createSensorsView (lvl) {
  const events = new EventEmitter()

  return View(lvl, {
    map: function (msg) {
      if (!sanitize(msg)) return []
      if (!msg.value.timestamp) return []

      // If the data is from <<THE FUTURE>>, index it at _now_.
      let ts = msg.value.timestamp
      if (isFutureMonotonicTimestamp(ts)) ts = timestamp()

      if (msg.value.type.startsWith('sensor/') && msg.value.content.channel) {
        const key = `snsr!${msg.value.content.channel}!${charwise.encode(ts)}`

        return [[key, msg]]
      } else {
        return []
      }
    },

    indexed: function (msgs) {
      msgs
        .filter((msg) => Boolean(sanitize(msg)))
        .filter(
          (msg) =>
            msg.value.type.startsWith('sensor/') && msg.value.content.channel
        )
        .sort(cmpMsg)
        .forEach(function (msg) {
          events.emit('sensor', msg)
          events.emit(msg.value.content.channel, msg)
        })
    },

    api: {
      read: function (core, channel, opts) {
        opts = opts || {}

        const t = through.obj()

        if (opts.gt) {
          opts.gt = `snsr!${channel}!${charwise.encode(opts.gt)}!`
        } else {
          opts.gt = `snsr!${channel}!`
        }

        if (opts.lt) {
          opts.lt = `snsr!${channel}!${charwise.encode(opts.lt)}~`
        } else {
          opts.lt = `snsr!${channel}~`
        }

        this.ready(function () {
          const v = lvl.createValueStream(xtend({ reverse: true }, opts))
          v.pipe(t)
        })

        return readonly(t)
      },

      events: events
    }
  })
}

function createSensorChannelsView (lvl) {
  const events = new EventEmitter()

  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      const seen = {}
      let pending = 0

      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return

        if (msg.value && msg.value.content && msg.value.content.channel) {
          const channel = msg.value.content.channel

          pending++

          lvl.get('channel!' + channel, function (err) {
            if (err && err.notFound) {
              if (!seen[channel]) events.emit('add', channel)

              seen[channel] = true

              ops.push({
                type: 'put',
                key: 'channel!' + channel,
                value: 1
              })
            }

            if (!--pending) done()
          })
        }
      })

      if (!pending) done()

      function done () {
        lvl.batch(ops, next)
      }
    },

    api: {
      get: function (core, cb) {
        this.ready(function () {
          const channels = []

          lvl.createKeyStream({
            gt: 'channel!!',
            lt: 'channel!~'
          })
            .on('data', function (channel) {
              channels.push(channel.replace('channel!', ''))
            })
            .once('end', function () {
              cb(null, channels)
            })
            .once('error', cb)
        })
      },

      events: events
    },

    storeState: function (state, cb) {
      state = state.toString('base64')
      lvl.put('state', state, cb)
    },

    fetchState: function (cb) {
      lvl.get('state', function (err, state) {
        if (err && err.notFound) cb()
        else if (err) cb(err)
        else cb(null, Buffer.from(state, 'base64'))
      })
    }
  }
}

function messageListener (msg) {
  const { channel } = msg.value.content
  this._emitUpdate('new-sensor', {
    channel,
    message: Object.assign({}, msg)
  })
}

function cmpMsg (a, b) {
  return a.value.timestamp - b.value.timestamp
}

// Either returns a well-formed sensor message, or null.
function sanitize (msg) {
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  if (typeof msg.value.content !== 'object') return null
  if (typeof msg.value.timestamp !== 'number') return null
  if (typeof msg.value.type !== 'string') return null
  if (typeof msg.value.content.channel !== 'string') return null
  if (typeof msg.value.content.deviceId !== 'string') return null
  if (typeof msg.value.content.fields !== 'object') return null
  return msg
}

function monotonicTimestampToTimestamp (timestamp) {
  if (/^[0-9]+\.[0-9]+$/.test(String(timestamp))) {
    return Number(String(timestamp).split('.')[0])
  } else {
    return timestamp
  }
}

function isFutureMonotonicTimestamp (ts) {
  const timestamp = monotonicTimestampToTimestamp(ts)
  const now = new Date().getTime()
  return timestamp > now
}
