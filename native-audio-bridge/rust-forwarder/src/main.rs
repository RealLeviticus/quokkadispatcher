use anyhow::Result;
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use std::f32::consts::PI;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

const HEADER_SIZE: usize = 24;

#[derive(Parser, Debug)]
#[command(name = "qd-audio-forwarder")]
#[command(about = "QuokkaDispatcher native audio packet forwarder (starter)")]
struct Args {
    #[arg(long, default_value = "ws://127.0.0.1:30130/voice-relay/ingest")]
    endpoint: String,

    #[arg(long, default_value = "pcm16")]
    codec: String,

    #[arg(long, default_value_t = 1)]
    source: u8,

    #[arg(long, default_value_t = 1)]
    channels: u8,

    #[arg(long, default_value_t = 48_000)]
    sample_rate: u16,

    #[arg(long, default_value_t = 20)]
    frame_ms: u16,
}

#[derive(Clone, Copy)]
enum Codec {
    Opus = 1,
    Pcm16Le = 2,
}

impl Codec {
    fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "opus" => Codec::Opus,
            _ => Codec::Pcm16Le,
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn build_packet(
    source: u8,
    codec: Codec,
    channels: u8,
    sample_rate: u16,
    sequence: u32,
    payload: &[u8],
) -> Vec<u8> {
    let payload_len = payload.len().min(u16::MAX as usize) as u16;

    let mut out = Vec::with_capacity(HEADER_SIZE + payload_len as usize);
    out.extend_from_slice(b"QDAV");
    out.push(1); // version
    out.push(source);
    out.push(codec as u8);
    out.push(channels);
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&payload_len.to_le_bytes());
    out.extend_from_slice(&sequence.to_le_bytes());
    out.extend_from_slice(&now_ms().to_le_bytes());
    out.extend_from_slice(&payload[..payload_len as usize]);
    out
}

fn generate_pcm_sine(channels: u8, sample_rate: u16, frame_ms: u16, phase: &mut f32) -> Vec<u8> {
    let frames_per_packet = (sample_rate as u32 * frame_ms as u32 / 1000) as usize;
    let mut pcm = Vec::<u8>::with_capacity(frames_per_packet * channels as usize * 2);

    let freq_hz = 700.0_f32;
    let phase_step = (2.0 * PI * freq_hz) / sample_rate as f32;

    for _ in 0..frames_per_packet {
        let sample = (*phase).sin() * 0.20;
        let i16_sample = (sample * i16::MAX as f32) as i16;
        for _ in 0..channels {
            pcm.extend_from_slice(&i16_sample.to_le_bytes());
        }
        *phase += phase_step;
        if *phase > 2.0 * PI {
            *phase -= 2.0 * PI;
        }
    }

    pcm
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let codec = Codec::parse(&args.codec);

    let (ws, _) = connect_async(&args.endpoint).await?;
    let (mut writer, mut reader) = ws.split();

    tokio::spawn(async move {
        while let Some(msg) = reader.next().await {
            if let Ok(Message::Text(text)) = msg {
                println!("relay: {text}");
            }
        }
    });

    let mut seq: u32 = 0;
    let mut phase = 0.0_f32;
    let frame_sleep = Duration::from_millis(args.frame_ms as u64);

    println!("connected: {}", args.endpoint);
    println!(
        "source={} codec={} channels={} sample_rate={} frame_ms={}",
        args.source,
        args.codec,
        args.channels,
        args.sample_rate,
        args.frame_ms
    );

    loop {
        let payload = match codec {
            Codec::Pcm16Le => generate_pcm_sine(args.channels, args.sample_rate, args.frame_ms, &mut phase),
            Codec::Opus => {
                // Starter mode: no encoder included yet.
                // Replace with real Opus frame bytes from your capture stack.
                vec![0_u8; 32]
            }
        };

        let packet = build_packet(
            args.source,
            codec,
            args.channels,
            args.sample_rate,
            seq,
            &payload,
        );

        writer.send(Message::Binary(packet)).await?;
        seq = seq.wrapping_add(1);
        sleep(frame_sleep).await;
    }
}