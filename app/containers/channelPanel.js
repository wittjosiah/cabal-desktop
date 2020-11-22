import React from 'react'
import { connect } from 'react-redux'
import { ResponsiveLine } from '@nivo/line'

import {
  hideChannelPanel,
  leaveChannel,
  moderationAddAdmin,
  moderationAddMod,
  moderationBlock,
  moderationHide,
  moderationRemoveAdmin,
  moderationRemoveMod,
  moderationUnblock,
  moderationUnhide
} from '../actions'
import MemberList from './memberList'

const mapStateToProps = state => ({
  addr: state.currentCabal,
  cabal: state.cabals[state.currentCabal]
})

const mapDispatchToProps = dispatch => ({
  hideChannelPanel: ({ addr }) => dispatch(hideChannelPanel({ addr })),
  leaveChannel: ({ addr, channel }) => dispatch(leaveChannel({ addr, channel })),
  moderationAddAdmin: ({ addr, channel, reason, userKey }) => dispatch(moderationAddAdmin({ addr, channel, reason, userKey })),
  moderationAddMod: ({ addr, channel, reason, userKey }) => dispatch(moderationAddMod({ addr, channel, reason, userKey })),
  moderationBlock: ({ addr, channel, reason, userKey }) => dispatch(moderationBlock({ addr, channel, reason, userKey })),
  moderationHide: ({ addr, channel, reason, userKey }) => dispatch(moderationHide({ addr, channel, reason, userKey })),
  moderationRemoveAdmin: ({ addr, channel, reason, userKey }) => dispatch(moderationRemoveAdmin({ addr, channel, reason, userKey })),
  moderationRemoveMod: ({ addr, channel, reason, userKey }) => dispatch(moderationRemoveMod({ addr, channel, reason, userKey })),
  moderationUnblock: ({ addr, channel, reason, userKey }) => dispatch(moderationUnblock({ addr, channel, reason, userKey })),
  moderationUnhide: ({ addr, channel, reason, userKey }) => dispatch(moderationUnhide({ addr, channel, reason, userKey }))
})

function ChannelPanel (props) {
  function onClickLeaveChannel () {
    props.leaveChannel({
      addr: props.cabal.addr,
      channel: props.cabal.channel
    })
  }

  const canLeave = props.cabal.channel !== '!status'
  const hasMembers = props.cabal.channel !== '!status'
  const hasSensors = props.cabal.sensorMessages && props.cabal.sensorMessages.length > 0

  const groupedData = props.cabal.sensorMessages.reduce((acc, msg) => {
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

  const charts = []
  for (const field in groupedData) {
    const data = []
    for (const device in groupedData[field]) {
      data.push({ id: device, data: groupedData[field][device] })
    }
    charts.push(
      <div className="panel__content data" key={field}>
        <ResponsiveLine
          data={data}
          width={500}
          height={300}
          margin={{ top: 10, right: 10, bottom: 80, left: 80 }}
          animate={true}
          colors={['rgba(105, 58, 250)']}
          curve="monotoneX"
          xScale={{
            type: 'time',
            format: 'native',
          }}
          xFormat="time:%H:%M:%S"
          yScale={{
            type: 'linear',
            stacked: false,
          }}
          axisLeft={{
            legend: field,
            legendOffset: -36,
            legendPosition: 'middle',
          }}
          axisBottom={{
            tickValues: 10,
            tickSize: 5,
            tickPadding: 5,
            tickRotation: -45,
            format: '%b %d %H:%M',
          }}
          useMesh={true}
          enableSlices={false}
        />
      </div>
    )
  }

  const className=`panel ChannelPanel${hasSensors ? ' DataPanel' : ''}`

  return (
    <div className={className}>
      <div className='panel__header'>
        Channel Details
        <span onClick={() => props.hideChannelPanel({ addr: props.addr })} className='close'><img src='static/images/icon-composermeta.svg' /></span>
      </div>
      {canLeave &&
        <div className='panel__content'>
          <div className='content__container'>
            <button className='button' onClick={onClickLeaveChannel}>
              Leave Channel
            </button>
          </div>
        </div>}
      {hasMembers &&
        <>
          <div className='section__header'>
            Channel Members
          </div>
          <div className='panel__content'>
            <MemberList addr={props.addr} />
          </div>
        </>}
      {hasSensors &&
       <>
         <div className='section__header'>
           Channel Data
         </div>
         {charts}
       </>}
    </div>
  )
}

export default connect(mapStateToProps, mapDispatchToProps)(ChannelPanel)
