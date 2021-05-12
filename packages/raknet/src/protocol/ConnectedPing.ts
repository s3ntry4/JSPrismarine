import { Identifiers } from './Identifiers';
import Packet from './Packet';

export default class ConnectedPing extends Packet {
    public clientTimestamp!: bigint;
    
    public constructor(buffer: Buffer) {
        super(Identifiers.CONNECTED_PING, buffer);
    }

    public decodePayload(): void {
        this.clientTimestamp = this.readLong();
    }

    public encodePayload(): void {
        this.writeLong(this.clientTimestamp);
    }
}
