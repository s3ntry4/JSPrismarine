import { Identifiers } from './Identifiers';
import Packet from './Packet';
import { RemoteInfo } from 'dgram';

export default class ConnectionRequestAccepted extends Packet {
    public constructor(buffer?: Buffer) {
        super(Identifiers.CONNECTION_REQUEST_ACCEPTED, buffer);
    }

    public clientAddress!: RemoteInfo;
    public requestTimestamp!: bigint;
    public acceptedTimestamp!: bigint;

    public decodePayload(): void {
        this.clientAddress = this.readAddress();
        this.readShort(); // Unknown
        for (let i = 0; i < 20; i++) {
            this.readAddress();
        }

        this.requestTimestamp = this.readLong();
        this.acceptedTimestamp = this.readLong();
    }

    public encodePayload(): void {
        this.writeAddress(this.clientAddress);
        this.writeShort(0); // Unknown
        for (let i = 0; i < 20; i++) {
            this.writeAddress(this.clientAddress);
        }
        this.writeLong(this.requestTimestamp);
        this.writeLong(this.acceptedTimestamp);
    }
}
