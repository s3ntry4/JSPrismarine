import BinaryStream from '@jsprismarine/jsbinaryutils';
import { FrameFlags } from './FrameFlags';
import { FrameReliability } from './FrameReliability';

// This is basically the utitliy to decode the message inside a datagram
// a datagram may contain multiple messages.
// This class is also known as EncapsulatedPacket.
export default class Frame {
    public reliability = FrameReliability.UNRELIABLE;

    // Only if reliable
    public reliableIndex!: number;
    // Only if sequenced
    public sequenceIndex!: number;
    // Only if ordered
    public orderedIndex!: number;
    public orderChannel!: number;
    // Only if fragmented
    public fragmentSize = 0;
    // Refers to the ID of the fragmented packet
    public fragmentID!: number;
    // Refers to the index in the fragments array
    public fragmentIndex!: number;

    public content!: Buffer;

    public static fromBinary(stream: BinaryStream): Frame {
        const packet = new Frame();
        const flags = stream.readByte();
        // The first 3 bits are the reliability type
        const reliability = (packet.reliability = (flags & 224) >> 5);
        const fragmented = (flags & FrameFlags.SPLIT) > 0;
        const bitLength = stream.readShort();

        if (Frame.isReliable(reliability)) {
            packet.reliableIndex = stream.readLTriad();
        }

        if (Frame.isSequenced(reliability)) {
            packet.sequenceIndex = stream.readLTriad();
        }

        if (Frame.isOrdered(reliability)) {
            packet.orderedIndex = stream.readLTriad();
            packet.orderChannel = stream.readByte();
        }

        if (fragmented) {
            packet.fragmentSize = stream.readInt();
            packet.fragmentID = stream.readShort();
            packet.fragmentIndex = stream.readInt();
        }

        packet.content = stream.read(bitLength / 8);
        return packet;
    }

    public toBinary(): Buffer {
        const stream = new BinaryStream();
        let flags = this.reliability << 5;
        if (this.fragmentSize > 0) {
            flags |= FrameFlags.SPLIT;
        }
        stream.writeByte(flags);
        stream.writeShort(this.content.byteLength * 8);

        if (Frame.isReliable(this.reliability)) {
            stream.writeLTriad(this.reliableIndex);
        }

        if (Frame.isSequenced(this.reliability)) {
            stream.writeLTriad(this.sequenceIndex);
        }

        if (Frame.isOrdered(this.reliability)) {
            stream.writeLTriad(this.orderedIndex);
            stream.writeByte(this.orderChannel);
        }

        if (this.fragmentSize > 0) {
            stream.writeInt(this.fragmentSize);
            stream.writeShort(this.fragmentID);
            stream.writeInt(this.fragmentIndex);
        }

        stream.append(this.content);
        return stream.getBuffer();
    }

    public static isReliable(reliability: number): boolean {
        return [
            FrameReliability.RELIABLE,
            FrameReliability.RELIABLE_ORDERED,
            FrameReliability.RELIABLE_SEQUENCED,
            FrameReliability.RELIABLE_WITH_ACK_RECEIPT,
            FrameReliability.RELIABLE_ORDERED_WITH_ACK_RECEIPT
        ].includes(reliability);
    }

    public static isSequenced(reliability: number): boolean {
        return [FrameReliability.RELIABLE_SEQUENCED, FrameReliability.UNRELIABLE_SEQUENCED].includes(reliability);
    }

    public static isOrdered(reliability: number): boolean {
        return [
            FrameReliability.UNRELIABLE_SEQUENCED,
            FrameReliability.RELIABLE_ORDERED,
            FrameReliability.RELIABLE_SEQUENCED,
            FrameReliability.RELIABLE_ORDERED_WITH_ACK_RECEIPT
        ].includes(reliability);
    }

    public getByteSize(): number {
        // 4 bytes -> seq number + flags
        return (
            4 +
            (Frame.isReliable(this.reliability) ? 3 : 0) +
            (Frame.isSequenced(this.reliability) ? 3 : 0) +
            (Frame.isOrdered(this.reliability) ? 4 : 0) +
            (Frame.isFragmented(this) ? 10 : 0) +
            this.content.byteLength
        );
    }

    public static isFragmented(frame: Frame): boolean {
        return frame.fragmentSize > 0;
    }
}
