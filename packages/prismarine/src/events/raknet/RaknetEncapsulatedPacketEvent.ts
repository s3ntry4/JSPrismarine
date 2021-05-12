import Event from '../Event';
import type { InetAddress } from '@jsprismarine/raknet';
import { Protocol } from '@jsprismarine/raknet';
import { RemoteInfo } from 'node:dgram';

export default class RaknetEncapsulatedPacketEvent extends Event {
    private readonly inetAddr: RemoteInfo;
    private readonly packet: Protocol.EncapsulatedPacket;

    public constructor(inetAddr: RemoteInfo, packet: Protocol.EncapsulatedPacket) {
        super();
        this.inetAddr = inetAddr;
        this.packet = packet;
    }

    public getInetAddr(): RemoteInfo {
        return this.inetAddr;
    }

    public getPacket(): Protocol.EncapsulatedPacket {
        return this.packet;
    }
}
