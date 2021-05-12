import { Identifiers } from './Identifiers';
import Packet from './Packet';

export default class ConnectedPong extends Packet {
    public clientTimestamp!: bigint;
    public serverTimestamp!: bigint;

    public constructor() {
        super(Identifiers.CONNECTED_PONG);
    }

    public encodePayload(): void {
        this.writeLong(this.clientTimestamp);
        this.writeLong(this.serverTimestamp);
    }
}
