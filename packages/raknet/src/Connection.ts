import { RangedRecord, Record, SingleRecord } from './protocol/Record';

import ACK from './protocol/ACK';
import BinaryStream from '@jsprismarine/jsbinaryutils';
import ConnectedPing from './protocol/ConnectedPing';
import ConnectedPong from './protocol/ConnectedPong';
import ConnectionRequest from './protocol/ConnectionRequest';
import ConnectionRequestAccepted from './protocol/ConnectionRequestAccepted';
import Frame from './protocol/Frame';
import { FrameFlags } from './protocol/FrameFlags';
import { FrameReliability } from './protocol/FrameReliability';
import FrameSetPacket from './protocol/FrameSetPacket';
import { Identifiers } from './protocol/Identifiers';
import Listener from './Listener';
import NACK from './protocol/NACK';
import NewIncomingConnection from './protocol/NewIncomingConnection';
import OpenConnectionReply1 from './protocol/OpenConnectionReply1';
import OpenConnectionReply2 from './protocol/OpenConnectionReply2';
import OpenConnectionRequest1 from './protocol/OpenConnectionRequest1';
import OpenConnectionRequest2 from './protocol/OpenConnectionRequest2';
import Packet from './protocol/Packet';
import { RemoteInfo } from 'dgram';
import assert from 'assert'

export default class Connection {
    private readonly listener: Listener;
    protected readonly rinfo: RemoteInfo;

    // MaximumTransferUnit used to indetify
    // maximum buffer length we can send per packet
    private mtu!: number;

    private receiveTimestamp = Date.now();

    // Holds the received sequence numbers
    private inputSequenceNumbers: Set<number> = new Set();
    // Holds the sent packets identified by their sequence numbers
    private outputFrameSets: Map<number, FrameSetPacket> = new Map();
    // Queue holding output frames
    private outputFramesQueue: Set<Frame> = new Set();
    // Holds the actual sequence number
    private outputSequenceNumber = 0;
    // Holds the reliable index for reliable frame sets
    private outputReliableIndex = 0;
    // Holds the sequence number of lost packets
    private nackSequenceNumbers: Set<number> = new Set();

    // Used by ordered reliable frame sets
    private orderingIndexes: Map<number, number> = new Map();
    // Used to identify split packets
    private fragmentID = 0;

    // fragmentID -> FragmentedFrame ( index -> buffer )
    private fragmentedFrames: Map<number, Map<number, Frame>> = new Map();

    public constructor(listener: Listener, rinfo: RemoteInfo) {
        this.listener = listener;
        this.rinfo = rinfo;
    }

    public tick(timestamp: number): void {
        if (this.receiveTimestamp + 10000 < timestamp) {
            this.disconnect('timeout');
            return;
        }

        // Acknowledge recived packets to the other end
        if (this.inputSequenceNumbers.size > 0) {
            const records: Set<Record> = new Set();
            const sequences = Array.from(this.inputSequenceNumbers).sort((a, b) => a - b);

            const deleteSeqFromInputQueue = (seqNum: number) => {
                if (!this.inputSequenceNumbers.has(seqNum)) {
                    return;
                }
                this.inputSequenceNumbers.delete(seqNum);
            };

            for (let i = 1, continuous = 0; i <= sequences.length; i++) {
                const prevSeq = sequences[i - 1];
                // In the last iteration sequences[i] will be undefined, but it does its job correctly, good boy
                if (sequences[i] - prevSeq == 1) {
                    continuous++;
                } else {
                    if (continuous == 0) {
                        records.add(new SingleRecord(prevSeq));
                        deleteSeqFromInputQueue(prevSeq);
                    } else {
                        const start = sequences[i - 1] - continuous;
                        records.add(new RangedRecord(start, prevSeq));

                        for (let j = start; j < prevSeq; j++) {
                            deleteSeqFromInputQueue(j);
                        }
                        continuous = 0;
                    }
                }
            }

            const ack = new ACK();
            ack.records = records;
            this.sendPacket(ack);
        }

        // TODO: Not Acknowledge non received packets
        if (this.nackSequenceNumbers.size > 0) {
   
            if (this.nackSequenceNumbers.size == 1) {
                // Single sequence number
            } else {
                // Ranged sequence numbers
            }
        }

        // Send all queued frames and clear queue
        if (this.outputFramesQueue.size > 0) {
            const frameSet = new FrameSetPacket();
            frameSet.sequenceNumber = this.outputSequenceNumber++;
            const frames = Array.from(this.outputFramesQueue);
            frameSet.frames = frames;
            this.sendFrameSet(frameSet);
            // Delete sent frames from output queue
            for (const frame of frames) {
                this.outputFramesQueue.delete(frame);
            }
        }
    }

    public async handle(buffer: Buffer, rinfo: RemoteInfo): Promise<void> {
        if (!(await this.handleDatagram(buffer, rinfo))) {
          const packetId = buffer.readUInt8()
          if (packetId & FrameFlags.ACK) {
            this.handleAcknowledgement(buffer)
          } else if (packetId & FrameFlags.NACK) {
            // Handle negative acknowledgement
            this.handleNacknowledgement(buffer)
          } else {
            this.handleConnectedDatagram(buffer)
          }
        }
      }

      private async handleDatagram(
        buffer: Buffer,
        rinfo: RemoteInfo
      ): Promise<boolean> {
        // Used to timout the client if we don't receive new packets
        this.receiveTimestamp = Date.now()
    
        const packetId = buffer.readUInt8()
        if (packetId == Identifiers.OPEN_CONNECTION_REQUEST_1) {
          await this.handleOpenConnectionRequestOne(buffer)
          return true
        } else if (packetId == Identifiers.OPEN_CONNECTION_REQUEST_2) {
          await this.handleOpenConnectionRequestTwo(buffer, rinfo)
          return true
        }
    
        return false
      }

      private handleConnectedDatagram(buffer: Buffer): void {
        const frameSetPacket = new FrameSetPacket(buffer)
        frameSetPacket.decode()
    
        // Every FrameSet contains a sequence number that is used
        // to retrive lost packets or to ignore duplicated ones
    
        // Ignore the packet if we already received it
        if (this.inputSequenceNumbers.has(frameSetPacket.sequenceNumber)) {
          return
        }
        // Add into received ones if we didn't received it before
        this.inputSequenceNumbers.add(frameSetPacket.sequenceNumber)
    
        // Remove the sequence number from the lost ones if we received it now
        if (this.nackSequenceNumbers.has(frameSetPacket.sequenceNumber)) {
          this.nackSequenceNumbers.delete(frameSetPacket.sequenceNumber)
        }
    
        // Now we need to retrive missing sequence numbers
        const sequenceNumbers = Array.from(this.inputSequenceNumbers).sort(
          (a, b) => a - b
        )
        const [min, max] = [
          Math.min(...sequenceNumbers),
          Math.max(...sequenceNumbers),
        ]
        const missingSequenceNumbers = Array.from(
          Array(max - min),
          (_v, k) => k + min
        ).filter(k => !sequenceNumbers.includes(k))
        for (const missingSequenceNumber of missingSequenceNumbers) {
          this.nackSequenceNumbers.add(missingSequenceNumber)
        }
    
        for (const frame of frameSetPacket.frames) {
          this.handleFrame(frame)
        }
      }

      private handleFrame(frame: Frame): void {
        if (Frame.isFragmented(frame)) {
          return this.handleFragmentedFrame(frame)
        }
    
        const packetId = frame.content.readUInt8()
        const buffer = frame.content
    
        switch (packetId) {
          case Identifiers.CONNECTED_PING:
            const connectedPing = new ConnectedPing(buffer)
            connectedPing.decode()
    
            const connectedPong = new ConnectedPong()
            connectedPong.clientTimestamp = connectedPing.clientTimestamp
            connectedPong.serverTimestamp = process.hrtime.bigint()
            this.sendInstantPacket(connectedPong)
            break
          case Identifiers.CONNECTION_REQUEST:
            const connectionRequest = new ConnectionRequest(buffer)
            connectionRequest.decode()
    
            // TODO: GUID implementation
            // this.guid = connectionRequest.clientGUID
    
            const connectionRequestAccepted = new ConnectionRequestAccepted()
            connectionRequestAccepted.clientAddress = this.rinfo
            connectionRequestAccepted.requestTimestamp = connectionRequest.requestTimestamp
            connectionRequestAccepted.acceptedTimestamp = process.hrtime.bigint()
            this.sendInstantPacket(connectionRequestAccepted)
            break
          case Identifiers.NEW_INCOMING_CONNECTION:
            const newIncomingConnection = new NewIncomingConnection(buffer)
            newIncomingConnection.decode()
            
            this.listener.emit('openConnection', this);
            break
          case Identifiers.DISCONNECT_NOTIFICATION:
            this.listener.removeConnection(this)
            break
          case Identifiers.GAME_PACKET:
            // TODO
            this.listener.emit('encapsulated', frame, this)
            break
          default:
            return
        }
      }

      private handleFragmentedFrame(frame: Frame) {
        assert(Frame.isFragmented(frame), 'Cannot reasseble a non fragmented packet')
        const fragmentID = frame.fragmentID
        const fragmentIndex = frame.fragmentIndex
        if (!this.fragmentedFrames.has(fragmentID)) {
          const fragments = new Map()
          fragments.set(fragmentIndex, frame)
          this.fragmentedFrames.set(fragmentID, fragments)
        } else {
          const fragments = this.fragmentedFrames.get(fragmentID)!
          fragments.set(fragmentIndex, frame)
          this.fragmentedFrames.set(fragmentID, fragments)
    
          if (frame.fragmentSize == fragments.size) {
            const finalContent = new BinaryStream()
            const fragments = this.fragmentedFrames.get(fragmentID)!
            // Ensure the correctness of the buffer orders
            for (let i = 0; i < fragments.size; i++) {
              const splitContent = fragments.get(i)!
              finalContent.append(splitContent.content)
            }
    
            // TODO: not sure if i should set reliability
            // of the first splitted packet, need to confirm
            const firstFrame = fragments.get(0)!
            const reliability = firstFrame.reliability
            const finalFrame = new Frame()
            finalFrame.content = finalContent.getBuffer()
            finalFrame.reliability = reliability
            if (Frame.isOrdered(firstFrame.reliability)) {
              finalFrame.orderedIndex = firstFrame.orderedIndex
              firstFrame.orderChannel = firstFrame.orderChannel
            }
    
            this.fragmentedFrames.delete(fragmentID)
            this.handleFrame(finalFrame)
          }
        }
      }

      public sendInstantBuffer(
        buffer: Buffer,
        reliability = FrameReliability.UNRELIABLE
      ): void {
        const frame = new Frame()
        frame.reliability = reliability
        frame.content = buffer
        this.sendImmediateFrame(frame)
      }
    
      public sendInstantPacket<T extends Packet>(
        packet: T,
        reliability = FrameReliability.UNRELIABLE
      ): void {
        packet.encode()
        const frame = new Frame()
        frame.reliability = reliability
        frame.content = packet.getBuffer()
        this.sendImmediateFrame(frame)
      }
    
      public sendQueuedBuffer(
        buffer: Buffer,
        reliability = FrameReliability.UNRELIABLE
      ): void {
        const frame = new Frame()
        frame.reliability = reliability
        frame.content = buffer
        this.sendQueuedFrame(frame)
      }
    
      public sendQueuedPacket<T extends Packet>(
        packet: T,
        reliability = FrameReliability.UNRELIABLE
      ): void {
        packet.encode()
        const frame = new Frame()
        frame.reliability = reliability
        frame.content = packet.getBuffer()
        this.sendQueuedFrame(frame)
      }
    
      private getFilledFrame(frame: Frame): Frame {
        if (Frame.isReliable(frame.reliability)) {
          frame.reliableIndex = this.outputReliableIndex++
          if (Frame.isOrdered(frame.reliability)) {
            if (!this.orderingIndexes.has(frame.orderChannel)) {
              this.orderingIndexes.set(frame.orderChannel, 0)
              frame.orderedIndex = 0
            } else {
              const orderIndex = this.orderingIndexes.get(frame.orderChannel)!
              this.orderingIndexes.set(frame.orderChannel, orderIndex + 1)
              frame.orderedIndex = orderIndex + 1
            }
          }
        }
        return frame
      }
    
      private fragmentFrame(frame: Frame): Frame[] {
        const fragments: Array<Frame> = []
        const buffers: Map<number, Buffer> = new Map()
        let index = 0,
          splitIndex = 0
    
        while (index < frame.content.byteLength) {
          // Push format: [chunk index: int, chunk: buffer]
          buffers.set(splitIndex++, frame.content.slice(index, (index += this.mtu)))
        }
    
        for (const [index, buffer] of buffers) {
          const newFrame = new Frame()
          newFrame.fragmentID = this.fragmentID++
          newFrame.fragmentSize = buffers.size
          newFrame.fragmentIndex = index
          newFrame.reliability = frame.reliability
          newFrame.content = buffer
    
          if (Frame.isReliable(newFrame.reliability)) {
            newFrame.reliableIndex = this.outputReliableIndex++
            if (Frame.isOrdered(newFrame.reliability)) {
              newFrame.orderChannel = frame.orderChannel
              newFrame.orderedIndex = frame.orderedIndex
            }
          }
    
          fragments.push(newFrame)
        }
    
        return fragments
      }
    
      private sendQueuedFrame(frame: Frame): void {
        const filledFrame = this.getFilledFrame(frame)
    
        // Split the frame in multiple frames if its bytelength
        // length exceeds the maximumx transfer unit limit
        if (filledFrame.getByteSize() > this.mtu) {
          this.fragmentFrame(filledFrame).forEach(frame => {
            this.outputFramesQueue.add(frame)
          })
        } else {
          this.outputFramesQueue.add(frame)
        }
      }
    
      private sendImmediateFrame(frame: Frame): void {
        const filledFrame = this.getFilledFrame(frame)
    
        if (filledFrame.getByteSize() > this.mtu) {
          this.fragmentFrame(frame).forEach(frame => {
            const frameSet = new FrameSetPacket()
            frameSet.sequenceNumber = this.outputSequenceNumber++
            frameSet.frames.push(frame)
            this.sendFrameSet(frameSet)
          })
        } else {
          const frameSet = new FrameSetPacket()
          frameSet.sequenceNumber = this.outputSequenceNumber++
          frameSet.frames.push(frame)
          this.sendFrameSet(frameSet)
        }
      }
    
      private sendLostFrameSet(sequenceNumber: number): void {
        if (this.outputFrameSets.has(sequenceNumber)) {
          const packet = this.outputFrameSets.get(sequenceNumber)!
          this.outputFrameSets.delete(sequenceNumber)
          // Skip queues when resending a lost packet
          this.sendInstantPacket(packet)
        } else {
            // TODO: WTF
            return
        }
      }
    
      private handleAcknowledgement(buffer: Buffer): void {
        const ack = new ACK(buffer)
        ack.decode()

        for (const record of ack.records) {
          // Here we receive the sequence numbers of
          // packets that the other end succesfully received
          // so we just delete them from our send backup queue
          if (record.isSingle()) {
            const seqNum = (record as SingleRecord).getSeqNumber()
            if (this.outputFrameSets.has(seqNum)) {
              this.outputFrameSets.delete(seqNum)
            }
          } else {
            const startSeqNum = (record as RangedRecord).getStartSeqNumber()
            const endSeqNum = (record as RangedRecord).getEndSeqNumber()
    
            for (let i = startSeqNum; i <= endSeqNum; i++) {
              if (this.outputFrameSets.has(i)) {
                this.outputFrameSets.delete(i)
              }
            }
          }
        }
      }
    
      private handleNacknowledgement(buffer: Buffer): void {
        const nack = new NACK(buffer)
        nack.decode()
    
        nack.records.forEach(record => {
          if (record.isSingle()) {
            this.sendLostFrameSet((record as SingleRecord).getSeqNumber())
          } else {
            const startSeqNum = (record as RangedRecord).getStartSeqNumber()
            const endSeqNum = (record as RangedRecord).getStartSeqNumber()
            for (let i = startSeqNum; i < endSeqNum; i++) {
              this.sendLostFrameSet(i)
            }
          }
        })
      }
    
      private async handleOpenConnectionRequestOne(
        buffer: Buffer
      ): Promise<void> {
        // TODO: client GUID handling
        // if (this.socket.hasClientGuid(this.getGuid())) {
        //  this.sendAlreadyConnected()
        //  return
        // }
        const openConnectionRequestOne = new OpenConnectionRequest1(buffer)
        openConnectionRequestOne.decode()
    
        // if (openConnectionRequestOne.remoteProtocol != Info.PROTOCOL) {
          // TODO: this.sendIncompatibleProtocolVersion()
          // return
        // }
    
        const openConnectionReplyOne = new OpenConnectionReply1()
        openConnectionReplyOne.mtuSize =
          openConnectionRequestOne.mtuSize
        openConnectionReplyOne.serverGUID = this.listener.getGUID()
    
        this.sendPacket(openConnectionReplyOne)
      }
    
      private async handleOpenConnectionRequestTwo(
        buffer: Buffer,
        rinfo: RemoteInfo
      ): Promise<void> {
        const openConnectionRequestTwo = new OpenConnectionRequest2(buffer)
        openConnectionRequestTwo.decode()
    
        const openConnectionReplyTwo = new OpenConnectionReply2()
        openConnectionReplyTwo.clientAddress = rinfo
        openConnectionReplyTwo.mtuSize =
          openConnectionRequestTwo.mtuSize
        openConnectionReplyTwo.serverGUID = this.listener.getGUID()
    
        this.mtu = openConnectionRequestTwo.mtuSize

        this.sendPacket(openConnectionReplyTwo)
      }
    
      private sendFrameSet(frameSet: FrameSetPacket): void {
        // Add the frame into a backup queue
        this.outputFrameSets.set(frameSet.sequenceNumber, frameSet)
        this.sendPacket(frameSet)
      }

    // TODO
    /**
     * Kick a client
     * @param reason the reason message, optional
     */
    public disconnect(reason?: string): void {
        void this.listener.removeConnection(this, reason ?? '');
    }

    public async sendPacket<T extends Packet>(packet: T): Promise<void> {
        this.listener.sendPacket(packet, this.rinfo);
    }

    public async close() {
        const stream = new BinaryStream(Buffer.from('\u0000\u0000\u0008\u0015', 'binary'));
        // TODO
        // await this.addEncapsulatedToQueue(Frame.fromBinary(stream), Priority.IMMEDIATE); // Client discconect packet 0x15
    }

    public getRemoteInfo(): RemoteInfo {
        return this.rinfo
    }

}
