/**
 * Setup pgvector extension and indexes
 * Run with: pnpm tsx packages/prisma/setup-pgvector.ts
 */

import { prisma } from './src/index.js';

async function setup() {
  try {
    console.log('🔧 Setting up pgvector...');
    
    // Enable pgvector extension
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('✅ pgvector extension enabled');
    
    // Create IVFFlat index for BrollChunk
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS broll_chunk_embedding_idx 
      ON "BrollChunk" USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
    console.log('✅ BrollChunk embedding index created');
    
    // Create IVFFlat index for VoiceoverSegment
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS voiceover_segment_embedding_idx 
      ON "VoiceoverSegment" USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
    console.log('✅ VoiceoverSegment embedding index created');
    
    // Create helper function
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION find_similar_chunks(
        p_episode_id TEXT,
        p_segment_embedding vector(3072),
        p_limit INT DEFAULT 10
      )
      RETURNS TABLE (
        chunk_id TEXT,
        slot_clip_id TEXT,
        chunk_index INT,
        start_ms INT,
        end_ms INT,
        ai_tags TEXT[],
        ai_summary TEXT,
        similarity FLOAT
      ) AS $$
      BEGIN
        RETURN QUERY
        SELECT 
          bc.id,
          bc."slotClipId",
          bc."chunkIndex",
          bc."startMs",
          bc."endMs",
          bc."aiTags",
          bc."aiSummary",
          1 - (bc.embedding <=> p_segment_embedding) AS similarity
        FROM "BrollChunk" bc
        WHERE bc."episodeId" = p_episode_id
          AND bc.embedding IS NOT NULL
          AND bc."moderationStatus" = 'safe'
        ORDER BY bc.embedding <=> p_segment_embedding
        LIMIT p_limit;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✅ find_similar_chunks function created');
    
    console.log('🎉 pgvector setup complete!');
  } catch (error: any) {
    console.error('❌ Error setting up pgvector:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setup();
