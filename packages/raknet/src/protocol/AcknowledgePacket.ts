import Packet from './Packet';
import { RangedRecord, Record, SingleRecord } from './Record';

export default class AcknowledgePacket extends Packet {
    public records: Set<Record> = new Set()

    public decodePayload(): void {
        const records = this.readShort()
        for (let i = 0; i < records; i++) {
          const single = this.readBool()
          if (single) {
            const seqNum = this.readLTriad()
            this.records.add(new SingleRecord(seqNum))
          } else {
            const startSeqNum = this.readLTriad()
            const endSeqNum = this.readLTriad()
            this.records.add(new RangedRecord(startSeqNum, endSeqNum))
          }
        }
    }

    public encodePayload(): void {
        this.writeShort(this.records.size)
        for (const record of this.records) {
          this.writeBool(record.isSingle())
          if (record.isSingle()) {
            this.writeLTriad((record as SingleRecord).getSeqNumber())
          } else {
            this.writeLTriad((record as RangedRecord).getStartSeqNumber())
            this.writeLTriad((record as RangedRecord).getEndSeqNumber())
          }
        }
    }
}
