package codec

import (
	"bytes"
	"testing"
)

func TestVarintRoundTrip(t *testing.T) {
	cases := []uint32{0, 1, 127, 128, 255, 256, 16383, 16384, 1<<21 - 1, 1 << 21}
	for _, v := range cases {
		encoded := encodeVarint(v)
		decoded, n, err := decodeVarint(encoded)
		if err != nil {
			t.Fatalf("decodeVarint(%d): %v", v, err)
		}
		if decoded != v {
			t.Fatalf("varint roundtrip: got %d, want %d", decoded, v)
		}
		if n != len(encoded) {
			t.Fatalf("varint consumed %d bytes, encoded %d bytes", n, len(encoded))
		}
	}
}

func TestPomeloHeartbeatRoundTrip(t *testing.T) {
	cfg := &PomeloConfig{}
	pkt := &Packet{Heartbeat: true}

	data, err := pomeloEncode(pkt, cfg)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	// 验证外层包格式: type=0x03, length=0
	if data[0] != PomeloPacketHeartbeat {
		t.Fatalf("packet type: got 0x%02x, want 0x%02x", data[0], PomeloPacketHeartbeat)
	}
	if len(data) != 4 {
		t.Fatalf("heartbeat length: got %d, want 4", len(data))
	}

	decoded, err := pomeloDecodeBytes(data, cfg)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !decoded.Heartbeat {
		t.Fatal("decoded packet should be heartbeat")
	}
}

func TestPomeloDataRoundTrip(t *testing.T) {
	cfg := &PomeloConfig{UseRouteCompress: true}
	payload := []byte{0x01, 0x02, 0x03}

	pkt := &Packet{
		Route: 42,
		Seq:   100,
		Data:  payload,
	}

	data, err := pomeloEncode(pkt, cfg)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	// 验证外层包类型
	if data[0] != PomeloPacketData {
		t.Fatalf("packet type: got 0x%02x, want 0x%02x", data[0], PomeloPacketData)
	}

	decoded, err := pomeloDecodeBytes(data, cfg)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	if decoded.Route != 42 {
		t.Fatalf("route: got %d, want 42", decoded.Route)
	}
	if decoded.Seq != 100 {
		t.Fatalf("seq: got %d, want 100", decoded.Seq)
	}
	if !bytes.Equal(decoded.Data, payload) {
		t.Fatalf("data: got %v, want %v", decoded.Data, payload)
	}
}

func TestPomeloStreamDecode(t *testing.T) {
	cfg := &PomeloConfig{UseRouteCompress: true}
	pkt := &Packet{Route: 1, Seq: 2, Data: []byte{0xFF}}

	data, err := pomeloEncode(pkt, cfg)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	// 模拟流式读取: 拼接两个包
	stream := append(data, PomeloEncodeHeartbeat()...)
	reader := bytes.NewReader(stream)

	// 第一个包: 数据包
	raw1, err := pomeloDecodeRaw(reader)
	if err != nil {
		t.Fatalf("decodeRaw 1: %v", err)
	}
	decoded1, err := pomeloDecodeBytes(raw1, cfg)
	if err != nil {
		t.Fatalf("decodeBytes 1: %v", err)
	}
	if decoded1.Route != 1 || decoded1.Seq != 2 {
		t.Fatalf("packet 1: route=%d seq=%d", decoded1.Route, decoded1.Seq)
	}

	// 第二个包: 心跳
	raw2, err := pomeloDecodeRaw(reader)
	if err != nil {
		t.Fatalf("decodeRaw 2: %v", err)
	}
	decoded2, err := pomeloDecodeBytes(raw2, cfg)
	if err != nil {
		t.Fatalf("decodeBytes 2: %v", err)
	}
	if !decoded2.Heartbeat {
		t.Fatal("packet 2 should be heartbeat")
	}
}

func TestPomeloControlPacket(t *testing.T) {
	payload := []byte(`{"code":200}`)
	data := pomeloEncodePacket(PomeloPacketHandshake, payload)

	decoded, err := pomeloDecodeBytes(data, &PomeloConfig{})
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	if decoded.ExtCode != PomeloPacketHandshake {
		t.Fatalf("extCode: got 0x%02x, want 0x%02x", decoded.ExtCode, PomeloPacketHandshake)
	}
	if !bytes.Equal(decoded.Data, payload) {
		t.Fatalf("data: got %s, want %s", decoded.Data, payload)
	}
}

func TestPomeloResponseDecode(t *testing.T) {
	// 手工构建一个 Response 消息: flag(Response, no route compress) + msgId(varint) + payload
	msgId := uint32(42)
	payload := []byte{0x0A, 0x0B}

	flag := PomeloMsgResponse << 1 // Response 类型, 无路由压缩
	var msgData []byte
	msgData = append(msgData, flag)
	msgData = append(msgData, encodeVarint(msgId)...)
	msgData = append(msgData, payload...)

	pktData := pomeloEncodePacket(PomeloPacketData, msgData)

	decoded, err := pomeloDecodeBytes(pktData, &PomeloConfig{})
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	if decoded.Seq != 42 {
		t.Fatalf("seq: got %d, want 42", decoded.Seq)
	}
	if !bytes.Equal(decoded.Data, payload) {
		t.Fatalf("data: got %v, want %v", decoded.Data, payload)
	}
}
