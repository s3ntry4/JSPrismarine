import { FrameFlags } from './FrameFlags';
import Frame from './Frame';
import Packet from './Packet';

export default class DataPacket extends Packet {
    public sequenceNumber!: number;
    // Contains all the decoded (or to encode) messages
    public frames: Array<Frame> = [];

    public constructor(buffer?: Buffer) {
        super(FrameFlags.VALID, buffer);
    }

    public decodePayload(): void {
        this.sequenceNumber = this.readLTriad();
        do {
            this.frames.push(Frame.fromBinary(this));
        } while (!this.feof());
    }

    public encodePayload(): void {
        this.writeLTriad(this.sequenceNumber);
        for (const frame of this.frames) {
            this.append(frame.toBinary());
        }
    }
}
