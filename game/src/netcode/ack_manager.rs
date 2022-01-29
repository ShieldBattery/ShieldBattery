use prost::Message;
use std::collections::BTreeMap;

use crate::netcode::sequence_buffer::SequenceBuffer;
use crate::proto::messages::{GameMessage, GameMessagePayload};

// NOTE(tec27): This is higher than the IPv4 spec, but in practice will work for basically everyone.
// Setting a higher value lets us pack more redundant messages in each packet, increasing
// reliability.
const MIN_MTU: u32 = 1200;
const UDP_OVERHEAD: u32 = 68;
const RALLY_POINT_OVERHEAD: u32 = 13;
const MAX_GAME_MESSAGE_OVERHEAD: u32 = (9 + 1) + (9 + 1) + (4 + 1);
const MAX_PAYLOAD_SIZE: u32 =
    MIN_MTU - (UDP_OVERHEAD + RALLY_POINT_OVERHEAD + MAX_GAME_MESSAGE_OVERHEAD);

/// How many received packets to track before overwriting. We send acks in a 32-bit bitfield, so
/// storing anything more than 33 isn't valuable (32 bits + the ack for the current packet).
const PACKET_ACKS_SIZE: usize = 32 + 1;
/// How large the buffer of previously sent packets should be. Packets earlier than
/// `packet_num` - `size` will not be ackable, so this size should be chosen such that we can
/// definitely consider these packets lost.
const SENT_PACKETS_SIZE: usize = 256;

/// Value initially used for `remote_ack_num` before we've seen any packets from the remote client.
const NO_REMOTE_PACKETS_SEEN_NUM: u64 = 0xFFFF_FFFF_FFFF_FFFF;

// TODO(tec27): One case that isn't handled here is very large payloads (near the max size). We
// currently make no attempt to resend payloads outside of attaching them onto new sends, which for
// very large payloads may never be possible (i.e. there will never be enough space to fit them in
// another packet). We should probably have some way to collect payloads that are very old (or
// maybe use their send count?) for resending by themselves.

/// Manages state around sending packets and receiving acknowledgements, tracking packets that were
/// sent by this client. Packets contain one or more payloads, which have their own sequence
/// numbers. When an ack for a particular packet is received, all the payloads within it are also
/// considered acked and will not be included in any future packets.
pub struct AckManager {
    /// The current sequence number for packets being sent by this client. Will be increased for
    /// each packet sent.
    packet_num: u64,
    /// The current sequence number for individual payloads within the packet. Will be increased
    /// for each payload created.
    payload_num: u64,
    /// A mapping of packet_num -> information for packets sent by this client, so that we can
    /// identify what is being acked by the remote client.
    sent_packets: SequenceBuffer<SentPacket>,
    /// A mapping of payload_num -> payload for payloads that have been included in packets from
    /// this client.
    unacked_payloads: BTreeMap<u64, SentPayload>,
    /// Packets that have been received from the remote client. Used for building the `ack` and
    /// `ack_bits` fields of [`GameMessage`]s.
    received_packets: SequenceBuffer<ReceivedPacket>,
    /// The maximum size allowed for all of the payloads in a packet combined, in order for it to
    /// fit in a single packet. Packets below this size will have additional messages inserted into
    /// them to achieve better redundancy + latency in delivery. Note that packets above this size
    /// will still be turned into a GameMessage (and considered sent), they just won't have
    /// additional messages added past the initial one.
    max_payload_size: u32,
}

impl AckManager {
    pub fn new() -> Self {
        Self::with_max_payload_size(MAX_PAYLOAD_SIZE)
    }

    fn with_max_payload_size(max_payload_size: u32) -> Self {
        Self {
            packet_num: 0,
            payload_num: 0,
            sent_packets: SequenceBuffer::with_capacity(SENT_PACKETS_SIZE),
            unacked_payloads: BTreeMap::new(),
            received_packets: SequenceBuffer::with_capacity(PACKET_ACKS_SIZE),
            max_payload_size,
        }
    }

    fn last_seen_remote_packet_num(&self) -> u64 {
        self.received_packets.sequence().wrapping_sub(1)
    }

    /// Returns the number of payloads that have been sent that are not currently acked.
    #[allow(dead_code)] // TODO(tec27): Use this in some stat reporting
    pub fn payloads_in_flight(&self) -> usize {
        self.unacked_payloads.len()
    }

    /// Constructs the `ack_bits` field for a [`GameMessage`], building a 32-bit bitfield with a 1
    /// for each of the last 32 packets that have been seen.
    fn ack_bits(&self) -> u32 {
        let most_recent_seq = self.last_seen_remote_packet_num();
        if most_recent_seq == NO_REMOTE_PACKETS_SEEN_NUM {
            return 0;
        }

        let mut result: u32 = 0;
        let mut mask: u32 = 1;
        for i in 1..=32 {
            if most_recent_seq < i as u64 {
                // Haven't seen enough packets to build the full ack bits yet
                break;
            }
            let seq = most_recent_seq - i;
            if self.received_packets.exists(seq) {
                result |= mask
            }
            mask <<= 1;
        }

        result
    }

    pub fn handle_incoming(&mut self, incoming: &GameMessage) {
        if (incoming.ack != NO_REMOTE_PACKETS_SEEN_NUM && incoming.ack > self.packet_num)
            || (incoming.ack == NO_REMOTE_PACKETS_SEEN_NUM && incoming.ack_bits != 0)
        {
            // TODO(tec27): Return an error and disconnect the client for a malformed packet?
            return;
        }
        if incoming.packet_num == NO_REMOTE_PACKETS_SEEN_NUM {
            // TODO(tec27): Return an error and disconnect the client for a malformed packet?
            return;
        }

        self.received_packets
            .insert(incoming.packet_num, ReceivedPacket {});

        if incoming.ack != NO_REMOTE_PACKETS_SEEN_NUM {
            let ack = incoming.ack;
            self.on_packet_acked(ack);

            let mut ack_bits = incoming.ack_bits;
            for i in 1..=32 {
                if ack < i as u64 {
                    break;
                }
                if ack_bits & 1 == 1 {
                    self.on_packet_acked(ack - i);
                }
                ack_bits >>= 1;
            }
        }
    }

    fn on_packet_acked(&mut self, sequence: u64) {
        let acked = self.sent_packets.remove(sequence);
        match acked {
            Some(packet) => {
                for id in packet.payload_nums.iter() {
                    self.unacked_payloads.remove(id);
                }
            }
            None => {}
        };
    }

    /// Constructs a new [`GameMessage`] containing the specified [`GameMessagePayload`] and other
    /// payloads selected by this manager to be included. The GameMessage will be given a proper
    /// sequence number, ack, and ack_bits for the current state of the manager. The given payload
    /// will have its `payload_num` initialized appropriately.
    ///
    /// Any messages built this way will be assumed to have been sent to the remote client, if they
    /// are not it can trigger delays in sending payloads.
    pub fn build_outgoing(&mut self, mut payload: GameMessagePayload) -> GameMessage {
        let mut message: GameMessage = GameMessage::default();
        message.packet_num = self.packet_num;
        self.packet_num += 1;
        message.ack = self.last_seen_remote_packet_num();
        message.ack_bits = self.ack_bits();

        payload.payload_num = self.payload_num;
        self.payload_num += 1;

        message.payloads.push(payload.clone());
        let payload_len = payload.encoded_len();
        self.unacked_payloads.insert(
            payload.payload_num,
            SentPayload {
                send_count: 1,
                payload,
                payload_len,
            },
        );

        if payload_len < self.max_payload_size as usize {
            let mut remaining = self.max_payload_size - payload_len as u32;
            for (_, p) in self.unacked_payloads.iter_mut() {
                if p.payload_len > remaining as usize {
                    continue;
                }

                p.send_count += 1;
                message.payloads.push(p.payload.clone());
                remaining -= p.payload_len as u32;
            }
        }

        self.sent_packets.insert(
            message.packet_num,
            SentPacket {
                packet_num: message.packet_num,
                payload_nums: message.payloads.iter().map(|p| p.payload_num).collect(),
            },
        );

        message
    }
}

#[derive(Default, Clone, Debug, PartialEq)]
struct SentPacket {
    /// The sequence number associated wit this packet.
    pub packet_num: u64,
    /// The `payload_num` of payloads that were contained within this packet.
    pub payload_nums: Box<[u64]>,
}

#[derive(Debug)]
struct SentPayload {
    pub send_count: u32,
    pub payload: GameMessagePayload,
    pub payload_len: usize,
}

#[derive(Clone, Default)]
struct ReceivedPacket;

#[cfg(test)]
mod tests {
    use crate::netcode::ack_manager::NO_REMOTE_PACKETS_SEEN_NUM;
    use prost::Message;

    use crate::proto::messages::game_message_payload::Payload;
    use crate::proto::messages::{GameMessage, GameMessagePayload, StormWrapper};

    use super::AckManager;
    use super::MAX_GAME_MESSAGE_OVERHEAD;

    #[test]
    fn check_game_message_overhead() {
        let mut message: GameMessage = GameMessage::default();
        // Set numbers that max out our sequence numbers to ensure we have calculated the max
        // byte overhead
        message.packet_num = 0x7FFF_FFFF_FFFF_FFFF;
        message.ack = 0x7FFF_FFFF_FFFF_FFFF;
        message.ack_bits = 0xFFFF_FFFF;

        assert_eq!(message.encoded_len() as u32, MAX_GAME_MESSAGE_OVERHEAD)
    }

    #[test]
    fn sequence_numbers_increment() {
        let mut manager = AckManager::new();

        for i in 0..10 {
            let payload = make_test_payload();
            let message = manager.build_outgoing(payload);

            assert_eq!(message.packet_num, i as u64);
            assert_eq!(message.payloads[0].payload_num, i as u64);
        }
    }

    #[test]
    fn ack_with_no_receives() {
        let mut manager = AckManager::new();
        let payload = make_test_payload();
        let message = manager.build_outgoing(payload);

        assert_eq!(message.ack, NO_REMOTE_PACKETS_SEEN_NUM);
        assert_eq!(message.ack_bits, 0);
    }

    #[test]
    fn ack_with_early_receives() {
        // Prevent multiple messages from being included in a packet since we want more fine-grained
        // control over what has been received here
        let mut manager = AckManager::with_max_payload_size(0);

        for _ in 0..10 {
            let payload = make_test_payload();
            manager.build_outgoing(payload);
        }

        assert_eq!(manager.payloads_in_flight(), 10);

        manager.handle_incoming(&make_fake_incoming(0, NO_REMOTE_PACKETS_SEEN_NUM, &[]));
        assert_eq!(manager.payloads_in_flight(), 10);

        manager.handle_incoming(&make_fake_incoming(1, 0, &[]));
        assert_eq!(manager.payloads_in_flight(), 9);

        manager.handle_incoming(&make_fake_incoming(2, 1, &[0]));
        manager.handle_incoming(&make_fake_incoming(3, 1, &[0]));
        manager.handle_incoming(&make_fake_incoming(4, 2, &[0, 1]));
        // simulate that packet 3 was dropped
        manager.handle_incoming(&make_fake_incoming(5, 4, &[0, 1, 2]));
        // simulate that packet 5 + 6 were dropped
        manager.handle_incoming(&make_fake_incoming(6, 9, &[0, 1, 2, 4, 7, 8]));
        assert_eq!(manager.payloads_in_flight(), 3);

        let payload = make_test_payload();
        let message = manager.build_outgoing(payload);
        let desired: u32 = 0b0011_1111;
        assert_eq!(message.ack, 6);
        assert_eq!(
            message.ack_bits, desired,
            "ack_bits {:#b} == {:#b}",
            message.ack_bits, desired
        );

        // simulate 3 delivered out of order, packet 7 from remote was dropped
        manager.handle_incoming(&make_fake_incoming(8, 10, &[0, 1, 2, 3, 4, 7, 8, 9]));
        assert_eq!(manager.payloads_in_flight(), 2);

        let payload = make_test_payload();
        let message = manager.build_outgoing(payload);
        // packet 7 (1 below current packet) was dropped
        let desired: u32 = 0b1111_1110;
        assert_eq!(message.ack, 8);
        assert_eq!(
            message.ack_bits, desired,
            "ack_bits {:#b} == {:#b}",
            message.ack_bits, desired
        );
    }

    #[test]
    fn symmetric_500_sends_without_loss() {
        let mut local = AckManager::new();
        let mut remote = AckManager::new();

        for _ in 0..500 {
            let payload = make_test_payload();
            let outgoing = local.build_outgoing(payload);

            let payload = make_test_payload();
            let incoming = remote.build_outgoing(payload);
            remote.handle_incoming(&outgoing);
            local.handle_incoming(&incoming);
        }

        // Last payload will still be in flight since we didn't build any messages after seeing it
        assert_eq!(local.payloads_in_flight(), 1);
        assert_eq!(remote.payloads_in_flight(), 1);
    }

    #[test]
    fn symmetric_100_sends_with_25pct_loss() {
        let mut local = AckManager::new();
        let mut remote = AckManager::new();

        let mut drop_count = 0;
        for i in 0..100 {
            let payload = make_test_payload();
            let outgoing = local.build_outgoing(payload);

            let payload = make_test_payload();
            let incoming = remote.build_outgoing(payload);

            if i % 4 == 0 {
                // drop it
                drop_count += 1;
            } else {
                remote.handle_incoming(&outgoing);
            }

            local.handle_incoming(&incoming);
        }

        assert_eq!(drop_count, 25);

        // Because of message duplication we expect that all the payloads have been delivered even
        // though some packets have dropped (except for the last payload, which will still be in
        // flight since we didn't build any messages after seeing it)
        assert_eq!(local.payloads_in_flight(), 1);
        assert_eq!(remote.payloads_in_flight(), 1);

        let message = local.build_outgoing(make_test_payload());
        assert_eq!(message.ack, 99);
        // No packet loss from remote -> local, so the acks should all be here
        let desired = 0b1111_1111_1111_1111_1111_1111_1111_1111;
        assert_eq!(
            message.ack_bits, desired,
            "ack_bits {:#b} == {:#b}",
            message.ack_bits, desired
        );

        let message = remote.build_outgoing(make_test_payload());
        assert_eq!(message.ack, 99);
        // Every 4th packet was dropped, this reads right to left from 98 -> 66
        let desired = 0b1011_1011_1011_1011_1011_1011_1011_1011;
        assert_eq!(
            message.ack_bits, desired,
            "ack_bits {:#b} == {:#b}",
            message.ack_bits, desired
        );
    }

    fn make_test_payload() -> GameMessagePayload {
        let mut payload: GameMessagePayload = GameMessagePayload::default();
        payload.payload = Some(Payload::Storm(StormWrapper::default()));
        payload
    }

    fn make_fake_incoming(packet_num: u64, ack: u64, acked_in_bits: &[u64]) -> GameMessage {
        let mut message: GameMessage = GameMessage::default();
        message.packet_num = packet_num;
        message.ack = ack;
        let mut ack_bits = 0;
        for &ack_id in acked_in_bits {
            if ack_id >= ack || ack_id < (ack.max(32) - 32) {
                continue;
            }
            let mask: u32 = 2u32.pow((ack - ack_id - 1) as u32);
            ack_bits |= mask;
        }
        message.ack_bits = ack_bits;

        message
    }
}
