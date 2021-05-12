import Dgram, { RemoteInfo, Socket } from 'dgram';

import Connection from './Connection';
import Crypto from 'crypto';
import { EventEmitter } from 'events';
import { Identifiers } from './protocol/Identifiers';
import RakNetListener from './RakNetListener';
import UnconnectedPing from './protocol/UnconnectedPing';
import UnconnectedPong from './protocol/UnconnectedPong';
import Packet from './protocol/Packet';

export interface ListenOptions {
    address?: string;
}

// Listen to packets and then process them
export default class Listener extends EventEmitter implements RakNetListener {
    private readonly socket: Socket;
    private readonly connections: Map<string, Connection> = new Map();
    private readonly guid: bigint;
    private readonly running = true;

    public constructor() {
        super();
        // Generate a signed random 64 bit GUID
        this.guid = Crypto.randomBytes(8).readBigInt64BE();
        this.socket = Dgram.createSocket('udp4').on('error', (err) => {
            throw err;
        });
        // this.server = server;
        // this.name = new ServerName(server);
        // this.name.setServerId(uniqueId);
    }

    /**
     * Creates a packet listener on given address and port.
     */
    public listen(port: number, options: ListenOptions = {}): Listener {
        this.socket.bind(port, options.address, () => this.emit('listening')); // TODO

        this.socket.on('message', async (msg, rinfo) => {
            if (!(await this.handleUnconnected(msg, rinfo))) {
                const session = this.retriveConnection(msg, rinfo);
                if (session != null) {
                    await session.handle(msg, rinfo);
                } else {
                    return;
                }
            }
        });

        // Sync handle all sessions
        const tick = setInterval(() => {
            if (!this.running) {
                clearInterval(tick);
            }

            for (const connection of this.connections.values()) {
                connection.tick(Date.now());
            }
        }, 50);

        return this
    }

    private async handleUnconnected(buffer: Buffer, rinfo: RemoteInfo): Promise<boolean> {
        const packetId = buffer.readUInt8();

        if (packetId == Identifiers.UNCONNECTED_PING) {
            await this.handleUnconnectedPing(buffer, rinfo)
            return true
        } else if (packetId == Identifiers.UNCONNECTED_PING_OPEN_CONNECTION) {
            // TODO: guid & guid connections
            await this.handleUnconnectedPing(buffer, rinfo)
            return true
        }
        return false
    }

    private async handleUnconnectedPing(buffer: Buffer, rinfo: RemoteInfo): Promise<void> {
        const unconnectedPing = new UnconnectedPing(buffer)
        unconnectedPing.decode()

        const unconnectedPong = new UnconnectedPong()
        unconnectedPong.sendTimestamp = unconnectedPing.sendTimestamp
        unconnectedPong.serverGUID = this.guid

        // TODO
        const motd =
        'MCPE;Test motd;428;1.16.210;0;20;' + this.guid + ';Second line;Creative;'

        unconnectedPong.serverName = motd
        this.sendPacket(unconnectedPong, rinfo)
    }

    private retriveConnection(msg: Buffer, rinfo: RemoteInfo): Connection | null {
        const token = `${rinfo.address}:${rinfo.port}`;
        if (!this.connections.has(token)) {
            const packetId = msg.readUInt8();
            if (packetId == Identifiers.OPEN_CONNECTION_REQUEST_1) {
                const connection = new Connection(this, rinfo);
                this.connections.set(token, connection);
            }
        }

        return this.connections.get(token) ?? null;
    }

    /**
     * Remove a connection from all connections.
     */
    // TODO
    public async removeConnection(connection: Connection, reason?: string): Promise<void> {
        const rinfo = connection.getRemoteInfo()
        const token = `${rinfo.address}:${rinfo.port}`;
        if (this.connections.has(token)) {
            await this.connections.get(token)?.close();
            this.connections.delete(token);
        }

        this.emit('closeConnection', rinfo, reason);
    }

    public sendPacket<T extends Packet>(packet: T, rinfo: RemoteInfo): void {
        packet.encode()  // TODO: proper checks
        const buffer = packet.getBuffer()
        this.socket.send(buffer, 0, buffer.length, rinfo.port, rinfo.address)
    }

    public getSocket() {
        return this.socket;
    }

    public getConnections() {
        return this.connections;
    }

    public getGUID(): bigint {
        return this.guid;
    }
}
