---
'voice-simulator': patch
---

Choose rise or fall of Hindi questions correctly (issue 45): a yes/no question that opens with the particle क्या rises (`क्या तुम आओगे?`), while क्या meaning "what" (`तुम क्या खाओगे?`, `तुम्हारा नाम क्या है?`, `क्या हुआ?`, `क्या बात है?`) and question words in any position (`आप कल कहाँ जा रहे हैं?`) fall. Each language now decides through an optional `questionFalls` hook of its verbaliser; English and Russian keep their behaviour.
