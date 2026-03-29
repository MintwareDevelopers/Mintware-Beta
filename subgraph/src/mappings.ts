import { BigInt, Bytes } from '@graphprotocol/graph-ts'
import {
  AgentRegistered,
  Erc8004Linked,
  ActionRecorded,
  MwpHashSubmitted,
  RiskPenaltyApplied,
  CampaignCreated,
} from '../generated/AIAttribution/AIAttribution'
import { Agent, ActionRecord, MwpSubmission, RiskEvent, Campaign, CampaignVolume } from '../generated/schema'

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadOrCreateAgent(address: Bytes, timestamp: BigInt): Agent {
  const id = address.toHexString()
  let agent = Agent.load(id)
  if (!agent) {
    agent = new Agent(id)
    agent.address          = address
    agent.erc8004TokenId   = null
    agent.isTransparent    = false
    agent.registeredAt     = timestamp
    agent.lastUpdatedAt    = timestamp
    agent.behavior         = BigInt.fromI32(0)
    agent.contribution     = BigInt.fromI32(0)
    agent.risk             = BigInt.fromI32(0)
    agent.interpretability = BigInt.fromI32(0)
    agent.totalScore       = BigInt.fromI32(0)
    agent.mwpSubmissions   = 0
    agent.lastMwpHash      = null
  }
  return agent
}

function recalcTotal(agent: Agent): BigInt {
  const positive = agent.behavior.plus(agent.contribution).plus(agent.interpretability)
  const result   = positive.minus(agent.risk)
  return result.lt(BigInt.fromI32(0)) ? BigInt.fromI32(0) : result
}

// ── Event handlers ────────────────────────────────────────────────────────────

export function handleAgentRegistered(event: AgentRegistered): void {
  const agent = loadOrCreateAgent(event.params.agent, event.block.timestamp)
  if (event.params.erc8004TokenId.gt(BigInt.fromI32(0))) {
    agent.erc8004TokenId = event.params.erc8004TokenId
  }
  agent.lastUpdatedAt = event.block.timestamp
  agent.save()
}

export function handleErc8004Linked(event: Erc8004Linked): void {
  const agent = loadOrCreateAgent(event.params.agent, event.block.timestamp)
  agent.erc8004TokenId = event.params.tokenId
  agent.lastUpdatedAt  = event.block.timestamp
  agent.save()
}

export function handleActionRecorded(event: ActionRecorded): void {
  const agent = loadOrCreateAgent(event.params.agent, event.block.timestamp)

  // Update behavior — contract stores volume/1e18 so we replicate here
  const delta       = event.params.volumeContributed.div(BigInt.fromString('1000000000000000000'))
  agent.behavior    = agent.behavior.plus(delta)
  agent.totalScore  = recalcTotal(agent)
  agent.lastUpdatedAt = event.block.timestamp
  agent.save()

  // ActionRecord entity
  const recordId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  const record   = new ActionRecord(recordId)
  record.agent             = agent.id
  record.campaignId        = event.params.campaignId
  record.volumeContributed = event.params.volumeContributed
  record.mwpHash           = event.params.mwpHash
  record.newScore          = event.params.newScore
  record.blockNumber       = event.block.number
  record.timestamp         = event.block.timestamp
  record.save()

  // Update CampaignVolume if part of a campaign
  if (event.params.campaignId.gt(BigInt.fromI32(0))) {
    const cvId = event.params.campaignId.toString() + '-' + event.params.agent.toHexString()
    let cv = CampaignVolume.load(cvId)
    if (!cv) {
      cv = new CampaignVolume(cvId)
      cv.campaign    = event.params.campaignId.toString()
      cv.agent       = agent.id
      cv.totalVolume = BigInt.fromI32(0)
    }
    cv.totalVolume       = cv.totalVolume.plus(event.params.volumeContributed)
    cv.lastContributedAt = event.block.timestamp
    cv.save()
  }
}

export function handleMwpHashSubmitted(event: MwpHashSubmitted): void {
  const agent = loadOrCreateAgent(event.params.agent, event.block.timestamp)

  // +50 interpretability per unique hash, cap 500
  const cap     = BigInt.fromI32(500)
  const current = agent.interpretability
  const bonus   = cap.minus(current).lt(BigInt.fromI32(50))
    ? cap.minus(current)
    : BigInt.fromI32(50)
  const safeBon = bonus.lt(BigInt.fromI32(0)) ? BigInt.fromI32(0) : bonus

  agent.interpretability = current.plus(safeBon)
  agent.mwpSubmissions   = event.params.submissionCount.toI32()
  agent.isTransparent    = true
  agent.lastMwpHash      = event.params.mwpHash
  agent.totalScore       = recalcTotal(agent)
  agent.lastUpdatedAt    = event.block.timestamp
  agent.save()

  // MwpSubmission entity
  const subId = agent.id + '-' + event.params.submissionCount.toString()
  const sub   = new MwpSubmission(subId)
  sub.agent           = agent.id
  sub.mwpHash         = event.params.mwpHash
  sub.submissionCount = event.params.submissionCount
  sub.blockNumber     = event.block.number
  sub.timestamp       = event.block.timestamp
  sub.save()
}

export function handleRiskPenaltyApplied(event: RiskPenaltyApplied): void {
  const agent = loadOrCreateAgent(event.params.agent, event.block.timestamp)
  agent.risk        = agent.risk.plus(event.params.penalty)
  agent.totalScore  = recalcTotal(agent)
  agent.lastUpdatedAt = event.block.timestamp
  agent.save()

  const riskId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  const risk   = new RiskEvent(riskId)
  risk.agent       = agent.id
  risk.penalty     = event.params.penalty
  risk.reason      = event.params.reason
  risk.blockNumber = event.block.number
  risk.timestamp   = event.block.timestamp
  risk.save()
}

export function handleCampaignCreated(event: CampaignCreated): void {
  const campaign    = new Campaign(event.params.campaignId.toString())
  campaign.campaignId   = event.params.campaignId
  campaign.protocol     = event.params.protocol
  campaign.name         = event.params.name
  campaign.targetVolume = BigInt.fromI32(0)   // set off-chain; not in event
  campaign.startTime    = event.block.timestamp
  campaign.endTime      = BigInt.fromI32(0)   // set off-chain
  campaign.active       = true
  campaign.createdAt    = event.block.timestamp
  campaign.save()
}
