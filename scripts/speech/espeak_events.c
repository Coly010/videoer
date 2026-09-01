#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int collect_events(short *wav, int sample_count, espeak_EVENT *events) {
  (void)wav;
  (void)sample_count;
  for (espeak_EVENT *event = events; event && event->type != espeakEVENT_LIST_TERMINATED; event++) {
    if (event->type == espeakEVENT_PHONEME) {
      char phoneme[9] = {0};
      memcpy(phoneme, event->id.string, 8);
      printf("{\"type\":\"phoneme\",\"phoneme\":\"%s\",\"audioPositionMs\":%d,\"textPosition\":%d}\n",
             phoneme, event->audio_position, event->text_position);
    } else if (event->type == espeakEVENT_WORD) {
      printf("{\"type\":\"word\",\"audioPositionMs\":%d,\"textPosition\":%d,\"length\":%d}\n",
             event->audio_position, event->text_position, event->length);
    } else if (event->type == espeakEVENT_END) {
      printf("{\"type\":\"end\",\"audioPositionMs\":%d,\"textPosition\":%d}\n",
             event->audio_position, event->text_position);
    }
  }
  fflush(stdout);
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 5) {
    fprintf(stderr, "usage: videoer-espeak-events <voice> <rate> <pitch> <text>\n");
    return 2;
  }
  int rate = atoi(argv[2]);
  int pitch = atoi(argv[3]);
  if (rate < espeakRATE_MINIMUM || rate > espeakRATE_MAXIMUM || pitch < 0 || pitch > 99) {
    fprintf(stderr, "invalid rate or pitch\n");
    return 2;
  }
  int sample_rate = espeak_Initialize(
      AUDIO_OUTPUT_SYNCHRONOUS, 0, NULL,
      espeakINITIALIZE_PHONEME_EVENTS | espeakINITIALIZE_DONT_EXIT);
  if (sample_rate <= 0) {
    fprintf(stderr, "failed to initialize eSpeak NG\n");
    return 1;
  }
  espeak_SetSynthCallback(collect_events);
  if (espeak_SetVoiceByName(argv[1]) != EE_OK) {
    fprintf(stderr, "failed to load voice '%s'\n", argv[1]);
    espeak_Terminate();
    return 1;
  }
  espeak_SetParameter(espeakRATE, rate, 0);
  espeak_SetParameter(espeakPITCH, pitch, 0);
  espeak_ng_SetRandSeed(0);
  const char *text = argv[4];
  espeak_ERROR result = espeak_Synth(
      text, strlen(text) + 1, 0, POS_CHARACTER, 0,
      espeakCHARS_UTF8 | espeakENDPAUSE, NULL, NULL);
  if (result == EE_OK) result = espeak_Synchronize();
  espeak_Terminate();
  return result == EE_OK ? 0 : 1;
}
