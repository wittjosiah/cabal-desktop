import React, { Component } from 'react'
import { ipcRenderer } from 'electron'
import { connect } from 'react-redux'
import prompt from 'electron-prompt'
import { debounce } from 'lodash'
import {
  changeScreen,
  hideEmojiPicker,
  leaveChannel,
  saveCabalSettings,
  setChannelTopic,
  showCabalSettings,
  showChannelPanel,
  viewCabal
} from '../actions'
import CabalSettings from './cabalSettings'
import ChannelBrowser from './channelBrowser'
import WriteContainer from './write'
import MessagesContainer from './messages'
import { currentChannelMemberCountSelector } from '../selectors'

const mapStateToProps = state => {
  const cabal = state.cabals[state.currentCabal] || {}
  const addr = cabal.addr
  return {
    addr,
    cabal,
    cabals: state.cabals,
    cabalSettingsVisible: state.cabalSettingsVisible,
    channelBrowserVisible: state.channelBrowserVisible,
    channelMemberCount: currentChannelMemberCountSelector(state),
    emojiPickerVisible: state.emojiPickerVisible,
    settings: state.cabalSettings[addr] || {},
  }
}

const mapDispatchToProps = dispatch => ({
  changeScreen: ({ screen, addr }) => dispatch(changeScreen({ screen, addr })),
  hideEmojiPicker: () => dispatch(hideEmojiPicker()),
  leaveChannel: ({ addr, channel }) => dispatch(leaveChannel({ addr, channel })),
  saveCabalSettings: ({ addr, settings }) => dispatch(saveCabalSettings({ addr, settings })),
  setChannelTopic: ({ addr, channel, topic }) =>
    dispatch(setChannelTopic({ addr, channel, topic })),
  showCabalSettings: ({ addr }) => dispatch(showCabalSettings({ addr })),
  showChannelPanel: ({ addr }) => dispatch(showChannelPanel({ addr })),
  viewCabal: ({ addr }) => dispatch(viewCabal({ addr })),
})

class MainPanel extends Component {
  constructor (props) {
    super(props)
    this.state = {
      showScrollToBottom: false
    }
    this.shouldAutoScroll = true
    this.scrollTop = 0
    this.scrollEl = null
    this.handleOpenCabalUrl = this.handleOpenCabalUrl.bind(this)
    this.setScrollToBottomButtonStatus = this.setScrollToBottomButtonStatus.bind(this)
    this.scrollToBottom = this.scrollToBottom.bind(this)
  }

  componentDidMount () {
    const self = this
    var messagesDiv = document.querySelector('.messages')
    if (messagesDiv) messagesDiv.scrollTop = this.scrollTop
    var messagesContainerDiv = document.querySelector('.window__main')
    if (messagesContainerDiv) {
      messagesContainerDiv.addEventListener(
        'scroll',
        self.onScrollMessages.bind(this)
      )
    }
    ipcRenderer.on('open-cabal-url', (event, arg) => {
      this.handleOpenCabalUrl(arg)
    })

    this.scrollEl?.addEventListener(
      'scroll',
      debounce(this.setScrollToBottomButtonStatus, 500, {
        leading: true,
        trailing: true
      })
    )
  }

  setScrollToBottomButtonStatus () {
    const totalHeight = this.scrollEl?.scrollHeight
    const scrolled = this.scrollEl?.scrollTop + 100
    const containerHeight = this.scrollEl?.offsetHeight
    if (scrolled < totalHeight - containerHeight) {
      this.setState({
        showScrollToBottom: true
      })
    } else if (scrolled >= totalHeight - containerHeight) {
      this.setState({
        showScrollToBottom: false
      })
    }

    this.scrollToBottom()
  }

  scrollToBottom () {
    this.scrollEl?.scrollBy(0, this.scrollEl?.scrollHeight)
  }

  componentWillUnmount () {
    const self = this
    var messagesContainerDiv = document.querySelector('.window__main')
    if (messagesContainerDiv) {
      messagesContainerDiv.removeEventListener(
        'scroll',
        self.onScrollMessages.bind(this)
      )
    }
  }

  componentDidUpdate (prevProps) {
    if ((prevProps.channelBrowserVisible !== this.props.channelBrowserVisible) ||
      (prevProps.cabalSettingsVisible !== this.props.cabalSettingsVisible)) {
      this.scrollToBottom()
    }
    if (prevProps.cabal !== this.props.cabal) {
      if (document.hasFocus()) {
        this.scrollToBottom()
      } else {
        this.setScrollToBottomButtonStatus()
      }
    }
  }

  onClickTopic () {
    prompt({
      title: 'Set channel topic',
      label: 'New topic',
      value: this.props.cabal.topic,
      type: 'input'
    })
      .then(topic => {
        if (topic && topic.trim().length > 0) {
          this.props.cabal.topic = topic
          this.props.setChannelTopic({
            addr: this.props.cabal.addr,
            channel: this.props.cabal.channel,
            topic
          })
        }
      })
      .catch(() => {
        console.log('cancelled new topic')
      })
  }

  onToggleFavoriteChannel (channelName) {
    const favorites = [...(this.props.settings['favorite-channels'] || [])]
    const index = favorites.indexOf(channelName)
    if (index > -1) {
      favorites.splice(index, 1)
    } else {
      favorites.push(channelName)
    }
    const settings = this.props.settings
    settings['favorite-channels'] = favorites
    this.props.saveCabalSettings({ addr: this.props.cabal.addr, settings })
  }

  handleOpenCabalUrl ({ url = '' }) {
    const addr = url.replace('cabal://', '').trim()
    if (this.props.cabals[addr]) {
      this.props.viewCabal({ addr })
    } else {
      this.props.changeScreen({ screen: 'addCabal', addr: url })
    }
  }

  onScrollMessages (event) {
    var element = event.target
    if (element.scrollHeight - element.scrollTop === element.clientHeight) {
      this.shouldAutoScroll = true
    } else {
      this.shouldAutoScroll = false
    }
  }

  hideModals () {
    if (this.props.emojiPickerVisible) {
      this.props.hideEmojiPicker()
    }
  }

  scrollToBottom (force) {
    if (!force && !this.shouldAutoScroll) return
    var messagesDiv = document.querySelector('.window__main')
    if (messagesDiv) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight
    }
  }

  showCabalSettings (addr) {
    this.props.showCabalSettings({ addr })
  }

  showChannelPanel (addr) {
    this.props.showChannelPanel({ addr })
  }

  render () {
    const { cabal, toggleMemberList, channelMemberCount, settings } = this.props
    var self = this

    if (!cabal) {
      return (
        <>
          <div />
        </>
      )
    } else if (this.props.channelBrowserVisible) {
      return <ChannelBrowser />
    } else if (this.props.cabalSettingsVisible) {
      return <CabalSettings />
    }

    const isFavoriteChannel = settings['favorite-channels'] && settings['favorite-channels'].includes(cabal.channel)

    return (
      <div className='client__main' onClick={this.hideModals.bind(this)}>
        <div className='window'>
          <div className='window__header'>
            <div className='channel-meta'>
              <div className='channel-meta__data'>
                <div className='channel-meta__data__details'>
                  <h1>
                    {cabal.channel}
                    <span
                      className='channel-meta__favoriteChannel__toggle'
                      onClick={self.onToggleFavoriteChannel.bind(self, cabal.channel)}
                      title={isFavoriteChannel ? 'Click to Unstar this channel' : 'Click to Star this channel'}
                    >
                      {isFavoriteChannel && <span>★</span>}
                      {!isFavoriteChannel && <span>☆</span>}
                    </span>
                  </h1>
                  <h2>
                    <div className='channel-meta__members' onClick={this.showChannelPanel.bind(this, this.props.addr)}>
                      <img src='static/images/user-icon.svg' />
                      <div 
                        className='channel-meta__members__count'
                        title={`Members in this channel: ${channelMemberCount}`}
                      >
                        {channelMemberCount}
                      </div>
                    </div>
                    <span
                      className='channel-meta__data__topic'
                      onClick={this.onClickTopic.bind(this)}
                      title='Click to set the channel topic'
                    >
                      {cabal.topic || 'Add a topic'}
                    </span>
                  </h2>
                </div>
              </div>
              <div className='channel-meta__other'>
                <div
                  onClick={this.showChannelPanel.bind(this, this.props.addr)}
                  className='channel-meta__other__more'
                  title='Channel Details'
                >
                  <img src='static/images/icon-channelother.svg' />
                </div>
              </div>
            </div>
          </div>
          <div
            className='window__main'
            ref={el => {
              this.scrollEl = el
            }}
          >
            <MessagesContainer cabal={cabal} />
          </div>
          <WriteContainer
            showScrollToBottom={this.state.showScrollToBottom}
            scrollToBottom={this.scrollToBottom}
          />
        </div>
      </div>
    )
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(MainPanel)
