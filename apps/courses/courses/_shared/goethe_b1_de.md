# Goethe B1 vocabulary list (German → ru / en / pl)

Reference list derived from the official Goethe-Institut B1 frequency
wortliste. `web/scripts/build-dictionary.ts` merges any entry whose
`(lemma, gender)` isn't already present in the lesson-derived corpus
into every `de.X` dictionary.

Frequency-ordered: top of the table is the most common B1 vocabulary.
Empty `Gender` column means the entry isn't a noun (verb, adjective,
adverb, particle, function word). Reflexive verbs are written with
`sich` at the front; the build script strips it for sorting.

When adding rows, keep German entries in canonical dictionary form:
- Nouns: `der/die/das + Noun` (with capitalized noun), `pl` in Gender for plural-only.
- Verbs: bare infinitive; `sich V` for reflexives.
- Adjectives/adverbs/particles: lowercase, no decoration.

| German | Gender | Russian | English | Polish |
|--------|--------|---------|---------|--------|
| und | | и | and | i |
| in | | в | in | w |
| mit | | с | with | z |
| zu | | к, в, до | to | do |
| so | | так | so | tak |
| man | | (безличное подлежащее) | one (impersonal) | (się — bezos.) |
| sagen | | сказать, говорить | to say | mówić, powiedzieć |
| da | | там, тут | there | tam, tu |
| viel | | много | much, many | dużo |
| ganz | | целый, весь | whole, entire | cały |
| bis | | до | until | do |
| wissen | | знать | to know | wiedzieć |
| das Mal | n | раз | time (occurrence) | raz |
| lassen | | давать, оставлять | to let, to leave | pozwolić, zostawić |
| stehen | | стоять | to stand | stać |
| der Mensch | m | человек | human, person | człowiek |
| das Beispiel | n | пример | example | przykład |
| die Zeit | f | время | time | czas |
| leben | | жить | to live | żyć |
| etwas | | что-то, нечто | something | coś |
| wenig | | мало, немного | little, few | mało |
| gegen | | против | against | przeciw |
| nichts | | ничто, ничего | nothing | nic |
| bleiben | | оставаться | to stay, remain | zostać |
| nun | | теперь, ну | now, well | teraz, no |
| sondern | | а, но (после "не") | but (rather) | lecz |
| tun | | делать | to do | robić |
| einmal | | однажды | once | raz |
| natürlich | | естественный, естественно | natural(ly) | naturalny |
| gleich | | одинаковый, сейчас | same, right away | ten sam, zaraz |
| nehmen | | брать, взять | to take | brać |
| dürfen | | мочь (с разрешения) | may, be allowed to | móc (mieć pozwolenie) |
| wichtig | | важный | important | ważny |
| vielleicht | | возможно, может быть | maybe, perhaps | może |
| hören | | слышать, слушать | to hear, listen | słyszeć |
| nein | | нет | no | nie |
| wer | | кто | who | kto |
| eigentlich | | вообще-то, собственно | actually | właściwie |
| fragen | | спрашивать | to ask | pytać |
| der Herr | m | господин | gentleman, mr. | pan |
| halten | | держать, останавливать | to hold, stop | trzymać |
| glauben | | верить, думать | to believe, think | wierzyć, sądzić |
| die Frage | f | вопрос | question | pytanie |
| gelten | | действовать, считаться | to apply, be valid | obowiązywać |
| gerade | | прямо, как раз | just, straight | właśnie, prosto |
| folgen | | следовать | to follow | nastąpić, śledzić |
| sprechen | | говорить | to speak | mówić |
| führen | | вести | to lead | prowadzić |
| bringen | | приносить | to bring | przynosić |
| die Welt | f | мир | world | świat |
| gar | | вовсе, совсем | at all, quite | wcale, zupełnie |
| eigen | | собственный | own | własny |
| genau | | точно, именно | exactly, precisely | dokładnie |
| mögen | | любить, нравиться | to like | lubić |
| spät | | поздний, поздно | late | późny |
| bereits | | уже | already | już |
| möglich | | возможный | possible | możliwy |
| während | | во время, в то время как | during, while | podczas, kiedy |
| dafür | | за это, для этого | for it, in return | za to |
| kurz | | короткий, коротко | short(ly) | krótki |
| richtig | | правильный, правильно | correct, right | właściwy, poprawny |
| stark | | сильный | strong | silny |
| brauchen | | нуждаться, требоваться | to need | potrzebować |
| die Hand | f | рука (кисть) | hand | ręka |
| etwa | | приблизительно, около | about, approximately | około |
| das Ende | n | конец | end | koniec |
| schreiben | | писать | to write | pisać |
| solch | | такой | such | taki |
| nie | | никогда | never | nigdy |
| der Fall | m | случай, падеж | case (instance, grammar) | przypadek |
| schön | | красивый, прекрасный | beautiful, nice | piękny |
| wirklich | | действительно, на самом деле | really, actually | naprawdę |
| nennen | | называть | to name, to call | nazywać |
| warum | | почему | why | dlaczego |
| ziehen | | тянуть, переезжать | to pull, to move | ciągnąć, przeprowadzać się |
| das Wort | n | слово | word | słowo |
| eben | | как раз, ровный | just, even | właśnie, równy |
| die Seite | f | сторона, страница | side, page | strona |
| das Teil | n | часть, деталь | part, piece | część |
| der Teil | m | часть | part | część |
| jung | | молодой | young | młody |
| fast | | почти | almost | prawie |
| schnell | | быстрый, быстро | fast, quickly | szybki |
| die Stadt | f | город | city | miasto |
| spielen | | играть | to play | grać, bawić się |
| zwar | | хотя, правда | indeed, admittedly | wprawdzie |
| die Arbeit | f | работа | work, job | praca |
| das Problem | n | проблема | problem | problem |
| sich verstehen | | понимать (друг друга), уживаться | to understand each other | rozumieć się |
| bekommen | | получать | to receive, to get | dostawać |
| meinen | | думать, иметь в виду | to mean, to think | sądzić, mieć na myśli |
| fahren | | ехать, везти | to drive, to go | jechać |
| kennen | | знать (быть знакомым) | to know (be acquainted) | znać |
| die Mutter | f | мать | mother | matka |
| der Weg | m | путь, дорога | way, path | droga |
| weiter | | дальше, далее | further | dalej |
| das Auge | n | глаз | eye | oko |
| oft | | часто | often | często |
| die Leute | pl | люди | people | ludzie |
| allerdings | | впрочем, однако | however, though | wprawdzie |
| sogar | | даже | even | nawet |
| jedoch | | однако | however | jednak |
| sich setzen | | садиться | to sit down | siadać |
| deshalb | | поэтому | therefore | dlatego |
| weit | | далёкий, далеко | far, wide | daleki |
| sitzen | | сидеть | to sit | siedzieć |
| der Vater | m | отец | father | ojciec |
| arbeiten | | работать | to work | pracować |
| das Geld | n | деньги | money | pieniądze |
| erklären | | объяснять | to explain | wyjaśniać |
| klar | | ясный, ясно | clear(ly) | jasny |
| der Doktor | m | доктор | doctor | lekarz, doktor |
| das Paar | n | пара | pair, couple | para |
| das Recht | n | право | right, law | prawo |
| wegen | | из-за | because of | z powodu |
| das Wasser | n | вода | water | woda |
| bestehen | | существовать, состоять, сдать | to exist, consist of, pass | istnieć, polegać, zdać |
| versuchen | | пытаться, пробовать | to try | próbować |
| der Punkt | m | точка, пункт | point, dot | punkt |
| der Grund | m | причина, основание | reason, ground | powód, podstawa |
| der Kopf | m | голова | head | głowa |
| beginnen | | начинать | to begin | zaczynać |
| laufen | | бежать, идти | to run, walk | biegać |
| das Bild | n | картина, изображение | picture, image | obraz |
| verschieden | | различный, разный | different, various | różny |
| der Name | m | имя | name | imię |
| die Aufgabe | f | задача, задание | task, assignment | zadanie |
| schwer | | тяжёлый, трудный | heavy, difficult | ciężki, trudny |
| treffen | | встречать | to meet | spotykać |
| die Art | f | вид, способ | kind, way | rodzaj, sposób |
| wohl | | пожалуй, видимо | well, probably | chyba, dobrze |
| die Geschichte | f | история, рассказ | history, story | historia |
| erzählen | | рассказывать | to tell, narrate | opowiadać |
| entstehen | | возникать | to arise, emerge | powstawać |
| sicher | | уверенный, надёжный | sure, safe | pewny, bezpieczny |
| neben | | рядом, около, кроме | next to, besides | obok, oprócz |
| allein | | один, в одиночку | alone | sam |
| die Abbildung | f | иллюстрация, изображение | illustration, figure | ilustracja |
| hinter | | за, позади | behind | za |
| besonders | | особенно | especially | szczególnie |
| tragen | | нести, носить | to carry, to wear | nosić |
| kaum | | едва | hardly, barely | ledwo |
| der Freund | m | друг | friend | przyjaciel |
| scheinen | | казаться, светить | to seem, to shine | wydawać się, świecić |
| die Stunde | f | час, урок | hour, lesson | godzina, lekcja |
| aussehen | | выглядеть | to look (appear) | wyglądać |
| gern | | охотно, с удовольствием | gladly, willingly | chętnie |
| überhaupt | | вообще | at all, generally | w ogóle |
| bestimmt | | определённый, наверняка | certain, definitely | pewny, na pewno |
| der Professor | m | профессор | professor | profesor |
| schaffen | | создавать, справляться | to create, to manage | tworzyć, zdążyć |
| damals | | тогда | back then, at that time | wtedy |
| erhalten | | получать, сохранять | to receive, to maintain | otrzymywać |
| lernen | | учиться, изучать | to learn | uczyć się |
| frei | | свободный | free | wolny |
| der Wert | m | стоимость, ценность | value, worth | wartość |
| suchen | | искать | to search, look for | szukać |
| gemeinsam | | совместный, общий | common, together | wspólny |
| rund | | круглый | round | okrągły |
| die Zahl | f | число, цифра | number | liczba |
| das Thema | n | тема | topic, subject | temat |
| handeln | | действовать, торговать | to act, to trade | działać, handlować |
| das Buch | n | книга | book | książka |
| deutlich | | ясный, отчётливый | clear, distinct | wyraźny |
| anders | | по-другому, иначе | differently | inaczej |
| politisch | | политический | political | polityczny |
| lesen | | читать | to read | czytać |
| der Blick | m | взгляд | look, glance | spojrzenie |
| die Form | f | форма | form, shape | forma |
| einzeln | | отдельный, по одному | single, individual | pojedynczy |
| erreichen | | достигать | to reach, achieve | osiągać |
| leicht | | лёгкий, легко | easy, light | łatwy, lekki |
| je | | когда-либо, по | ever, per | kiedykolwiek, po |
| verlieren | | терять | to lose | tracić |
| die Lösung | f | решение | solution | rozwiązanie |
| die Sache | f | дело, вещь | thing, matter | rzecz, sprawa |
| bekannt | | известный | known, famous | znany |
| das Ziel | n | цель | goal, aim | cel |
| steigen | | подниматься, расти | to climb, rise | wzrastać, wspinać się |
| eher | | скорее | rather, sooner | raczej |
| essen | | есть, кушать | to eat | jeść |
| der Platz | m | место, площадь | place, square | miejsce, plac |
| schlecht | | плохой, плохо | bad(ly) | zły |
| das Spiel | n | игра | game, play | gra |
| die Familie | f | семья | family | rodzina |
| jemand | | кто-то | someone | ktoś |
| fallen | | падать | to fall | spadać, upadać |
| der Preis | m | цена, приз | price, prize | cena, nagroda |
| sonst | | иначе, обычно | otherwise, usually | inaczej, poza tym |
| der Staat | m | государство | state | państwo |
| helfen | | помогать | to help | pomagać |
| der Bereich | m | область, сфера | area, field | obszar, dziedzina |
| tatsächlich | | фактически, действительно | actually, in fact | faktycznie |
| der Ort | m | место, населённый пункт | place, location | miejsce |
| einzig | | единственный | only, sole | jedyny |
| die Stelle | f | место, должность | place, position | miejsce, stanowisko |
| unterschiedlich | | различный | different, varying | różny, zróżnicowany |
| das Gesicht | n | лицо | face | twarz |
| die Entwicklung | f | развитие | development | rozwój |
| die Uhr | f | часы, час | clock, o'clock | zegar, godzina |
| mehrere | | несколько | several | kilka |
| schließen | | закрывать | to close | zamykać |
| schließlich | | наконец, в конце концов | finally, after all | wreszcie |
| legen | | класть | to lay, to put | kłaść |
| direkt | | прямой, прямо | direct(ly) | bezpośredni |
| daher | | поэтому, оттуда | hence, therefore | stąd, dlatego |
| die Doktorin | f | женщина-врач, докторша | doctor (female) | lekarka |
| die Professorin | f | женщина-профессор | professor (female) | profesorka |
| offen | | открытый, откровенный | open, frank | otwarty |
| erkennen | | узнавать, распознавать | to recognize | rozpoznawać |
| die Person | f | человек, лицо | person | osoba |
| der Moment | m | момент, мгновение | moment | moment, chwila |
| das Auto | n | автомобиль, машина | car | samochód |
| vorstellen | | представлять, знакомить | to introduce, to imagine | przedstawiać |
| treten | | ступать, наступать | to step | stąpać |
| die Gruppe | f | группа | group | grupa |
| gewinnen | | выигрывать, получать | to win | wygrywać |
| die Tür | f | дверь | door | drzwi |
| der Schritt | m | шаг | step | krok |
| der Sinn | m | смысл, чувство | sense, meaning | sens, zmysł |
| das System | n | система | system | system |
| die Rolle | f | роль, рулон | role | rola |
| erwarten | | ожидать | to expect | oczekiwać |
| allgemein | | общий, в целом | general, common | ogólny |
| fühlen | | чувствовать | to feel | czuć |
| erinnern | | напоминать, помнить | to remind, to remember | przypominać |
| bedeuten | | означать | to mean | oznaczać |
| die Reaktion | f | реакция | reaction | reakcja |
| der Raum | m | пространство, помещение | room, space | pomieszczenie, przestrzeń |
| häufig | | частый, часто | frequent(ly) | częsty |
| pro | | за, на (каждый) | per | na (za) |
| oben | | наверху, сверху | above, on top | na górze |
| die Richtung | f | направление | direction | kierunek |
| die Situation | f | ситуация | situation | sytuacja |
| außerdem | | кроме того | besides, moreover | poza tym |
| nämlich | | а именно, ведь | namely, that is | mianowicie |
| international | | международный | international | międzynarodowy |
| der Anfang | m | начало | beginning | początek |
| sozial | | социальный | social | społeczny |
| die Folge | f | следствие, серия | consequence, sequel | konsekwencja, odcinek |
| der Satz | m | предложение, набор | sentence, set | zdanie, komplet |
| beschreiben | | описывать | to describe | opisywać |
| das Licht | n | свет | light | światło |
| ähnlich | | похожий | similar | podobny |
| die Regel | f | правило | rule | zasada, reguła |
| gegenüber | | напротив, по отношению | opposite, towards | naprzeciwko |
| bisher | | до сих пор | until now | dotąd |
| tief | | глубокий | deep | głęboki |
| ebenfalls | | также, тоже | also, likewise | również |
| verlassen | | покидать, оставлять | to leave (a place) | opuszczać |
| die Idee | f | идея | idea | pomysł |
| verbinden | | соединять, связывать | to connect | łączyć |
| endlich | | наконец | finally | wreszcie |
| die Energie | f | энергия | energy | energia |
| einsetzen | | вставлять, применять | to insert, to deploy | wstawiać, używać |
| sich befinden | | находиться | to be located | znajdować się |
| die Information | f | информация | information | informacja |
| dagegen | | против этого, напротив | against it, in contrast | przeciw temu |
| der Text | m | текст | text | tekst |
| sterben | | умирать | to die | umierać |
| das Kapitel | n | глава (книги) | chapter | rozdział |
| ausgehen | | выходить, исходить | to go out, to assume | wychodzić, zakładać |
| die Bedeutung | f | значение, важность | meaning, importance | znaczenie |
| die Chemie | f | химия | chemistry | chemia |
| stimmen | | быть верным, голосовать | to be correct, to vote | zgadzać się, głosować |
| bitten | | просить | to ask, request | prosić |
| öffentlich | | общественный, публичный | public | publiczny |
| insgesamt | | в общей сложности | altogether, in total | łącznie |
| genug | | достаточно | enough | wystarczająco |
| verändern | | изменять | to change | zmieniać |
| gelingen | | удаваться | to succeed | udawać się |
| gering | | малый, незначительный | minor, slight | niewielki |
| der Film | m | фильм | film, movie | film |
| ansehen | | смотреть, рассматривать | to look at, watch | oglądać |
| die Musik | f | музыка | music | muzyka |
| schauen | | смотреть | to look | patrzeć |
| tot | | мёртвый | dead | martwy |
| der Gott | m | бог | god | bóg |
| völlig | | совершенно, полностью | completely | całkowicie |
| das Gespräch | n | разговор, беседа | conversation | rozmowa |
| die Kundin | f | клиентка | customer (female) | klientka |
| die Menge | f | количество, толпа | amount, crowd | ilość, tłum |
| annehmen | | принимать, предполагать | to accept, to assume | przyjmować, zakładać |
| falsch | | неправильный, ложный | wrong, false | zły, fałszywy |
| der Zusammenhang | m | связь, контекст | connection, context | związek, kontekst |
| rufen | | звать, кричать | to call, to shout | wołać |
| bieten | | предлагать | to offer | oferować |
| das Herz | n | сердце | heart | serce |
| ebenso | | так же | likewise, equally | tak samo |
| verwenden | | использовать, применять | to use | używać |
| die Politik | f | политика | politics | polityka |
| der Tod | m | смерть | death | śmierć |
| persönlich | | личный, лично | personal(ly) | osobisty |
| holen | | приносить, забирать | to fetch, get | przynieść |
| der Junge | m | мальчик, парень | boy | chłopiec |
| die Polizei | f | полиция | police | policja |
| innerhalb | | внутри, в течение | inside, within | wewnątrz |
| die Kunst | f | искусство | art | sztuka |
| die Lage | f | положение, ситуация | location, situation | położenie, sytuacja |
| die Schülerin | f | ученица | pupil, student (female) | uczennica |
| der Druck | m | давление, печать | pressure, print | nacisk, druk |
| bewegen | | двигать, трогать | to move | poruszać |
| enthalten | | содержать | to contain | zawierać |
| aufnehmen | | принимать, записывать | to take in, record | przyjmować, nagrywać |
| merken | | замечать, запоминать | to notice, remember | zauważać, zapamiętać |
| fest | | твёрдый, прочный | firm, fixed | stały, mocny |
| aktuell | | актуальный, текущий | current | aktualny |
| relativ | | относительно | relatively | względnie |
| der Fuß | m | нога (ступня) | foot | stopa |
| der Krieg | m | война | war | wojna |
| der Gast | m | гость | guest | gość |
| schwierig | | трудный, сложный | difficult | trudny |
| zusätzlich | | дополнительный | additional | dodatkowy |
| der Gedanke | m | мысль | thought | myśl |
| besitzen | | владеть, обладать | to own, possess | posiadać |
| hängen | | висеть, вешать | to hang | wisieć, wieszać |
| eng | | узкий, тесный | narrow, tight | wąski, ciasny |
| der Prozess | m | процесс, судебный процесс | process, trial | proces |
| der Dank | m | благодарность | thanks | podziękowanie |
| trotz | | несмотря на | despite | mimo |
| fordern | | требовать | to demand | żądać |
| das Mädchen | n | девочка, девушка | girl | dziewczyna |
| sich verhalten | | вести себя | to behave | zachowywać się |
| das Interesse | n | интерес | interest | zainteresowanie |
| unterscheiden | | различать | to distinguish | rozróżniać |
| jeweils | | в каждом случае, каждый | each, in each case | każdorazowo |
| reichen | | хватать, подавать | to suffice, to pass | wystarczać, podawać |
| zumindest | | по крайней мере | at least | przynajmniej |
| schlagen | | бить, ударять | to hit, beat | bić, uderzać |
| das Tier | n | животное | animal | zwierzę |
| erhöhen | | повышать | to raise, increase | podnosić |
| sorgen | | заботиться, обеспечивать | to care, to provide | troszczyć się |
| die Patientin | f | пациентка | patient (female) | pacjentka |
| geschehen | | происходить, случаться | to happen | zdarzać się |
| lösen | | решать, развязывать | to solve | rozwiązywać |
| anbieten | | предлагать | to offer | oferować |
| interessieren | | интересовать | to interest | interesować |
| das Foto | n | фотография | photo | zdjęcie |
| derselbe | | тот же самый | the same | ten sam |
| gleichzeitig | | одновременно | simultaneously | jednocześnie |
| knapp | | едва, недостаточно | scant, barely | ledwie |
| die Mitarbeiterin | f | сотрудница | employee, coworker (female) | współpracowniczka |
| übernehmen | | принимать, брать на себя | to take over | przejmować |
| normal | | обычный, нормальный | normal | normalny |
| die Leistung | f | производительность, достижение | performance, achievement | wydajność, osiągnięcie |
| auftreten | | выступать, появляться | to appear, perform | występować |
| technisch | | технический | technical | techniczny |
| die Höhe | f | высота | height | wysokość |
| zuletzt | | в последний раз, наконец | last, finally | ostatnio |
| rein | | чистый, лишь | pure, only | czysty |
| bauen | | строить | to build | budować |
| das Verhältnis | n | отношение, соотношение | relationship, ratio | stosunek |
| selten | | редкий, редко | rare(ly) | rzadki |
| statt | | вместо | instead of | zamiast |
| das Werk | n | произведение, завод | work (art), factory | dzieło, zakład |
| die Bürgerin | f | гражданка | citizen (female) | obywatelka |
| dienen | | служить | to serve | służyć |
| stecken | | вставлять, торчать | to put, to be stuck | wkładać, tkwić |
| das Mittel | n | средство | means, remedy | środek |
| leisten | | выполнять, позволить себе | to accomplish, afford | dokonywać, pozwolić sobie |
| der Lehrer | m | учитель | teacher (male) | nauczyciel |
| die Einführung | f | введение | introduction | wprowadzenie |
| klingen | | звучать | to sound | brzmieć |
| die Dame | f | дама | lady | dama, pani |
| das Modell | n | модель | model | model |
| unten | | внизу | below, at the bottom | na dole |
| die Mitte | f | середина, центр | middle, center | środek |
| beschäftigen | | заниматься, занимать | to occupy, employ | zajmować |
| miteinander | | друг с другом | with one another | ze sobą |
| werfen | | бросать | to throw | rzucać |
| reagieren | | реагировать | to react | reagować |
| die Autorin | f | автор (женщина) | author (female) | autorka |
| kriegen | | получать (разг.) | to get (colloquial) | dostawać (potocznie) |
| hart | | твёрдый, жёсткий | hard, tough | twardy |
| offenbar | | очевидно, по-видимому | apparently | najwyraźniej |
| sich beteiligen | | участвовать | to participate | uczestniczyć |
| erfolgreich | | успешный | successful | udany |
| der Zustand | m | состояние | state, condition | stan |
| wahr | | истинный, настоящий | true | prawdziwy |
| die Reihe | f | ряд, очередь | row, series | rząd, kolejka |
| rechnen | | считать, рассчитывать | to count, calculate | liczyć |
| bloß | | только, просто | merely, just | jedynie |
| notwendig | | необходимый | necessary | konieczny |
| privat | | частный, личный | private | prywatny |
| das Haar | n | волосы | hair | włosy |
| deswegen | | поэтому | therefore | dlatego |
| spüren | | чувствовать, ощущать | to feel, sense | czuć, odczuwać |
| feststellen | | устанавливать, констатировать | to establish, ascertain | stwierdzać |
| die Rede | f | речь | speech | mowa |
| unterstützen | | поддерживать | to support | wspierać |
| schlimm | | плохой, тяжёлый | bad, severe | zły |
| irgendwann | | когда-нибудь | sometime | kiedyś |
| die Angabe | f | данные, указание | information, statement | dane, podanie |
| außer | | кроме | except, besides | oprócz |
| das Alter | n | возраст | age | wiek |
| die Sicherheit | f | безопасность, уверенность | safety, security | bezpieczeństwo, pewność |
| niedrig | | низкий | low | niski |
| ständig | | постоянный, постоянно | constant(ly) | stały |
| liefern | | доставлять, поставлять | to deliver | dostarczać |
| die Erde | f | земля | earth | ziemia |
| die Studie | f | исследование, этюд | study | studium, badanie |
| drehen | | вращать, снимать (фильм) | to turn, to film | obracać, kręcić |
| die Künstlerin | f | художница, артистка | artist (female) | artystka |
| aktiv | | активный | active | aktywny |
| der Versuch | m | попытка, опыт | attempt, experiment | próba, eksperyment |
| die Methode | f | метод | method | metoda |
| die Ordnung | f | порядок | order, tidiness | porządek |
| erfüllen | | выполнять, исполнять | to fulfill | spełniać |
| die Region | f | регион, область | region | region |
| genauso | | точно так же | just as, equally | tak samo |
| überzeugen | | убеждать | to convince | przekonywać |
| interessant | | интересный | interesting | interesujący |
| menschlich | | человеческий | human | ludzki |
| speziell | | особый, специальный | special | szczególny |
| negativ | | негативный, отрицательный | negative | negatywny |
| zentral | | центральный | central | centralny |
| der Spieler | m | игрок | player (male) | gracz |
| die Spielerin | f | игрок (женщина) | player (female) | graczka |
| absolut | | абсолютный, совершенно | absolute(ly) | absolutny |
| fliegen | | летать | to fly | latać |
| das Feld | n | поле | field | pole |
| verdienen | | зарабатывать, заслуживать | to earn, to deserve | zarabiać, zasługiwać |
| das Mitglied | n | член (организации) | member | członek |
| die Gefahr | f | опасность | danger | niebezpieczeństwo |
| weltweit | | всемирный, по всему миру | worldwide | ogólnoświatowy |
| die Liebe | f | любовь | love | miłość |
| der Beginn | m | начало | beginning, start | początek |
| breit | | широкий | broad, wide | szeroki |
| das Blut | n | кровь | blood | krew |
| die Anzahl | f | количество | number, quantity | liczba |
| der Mund | m | рот | mouth | usta |
| mittlerweile | | тем временем, между тем | meanwhile | w międzyczasie |
| vorher | | раньше, прежде | before, earlier | wcześniej |
| der Kampf | m | борьба, бой | fight, battle | walka |
| das Programm | n | программа | program | program |
| die Temperatur | f | температура | temperature | temperatura |
| leer | | пустой | empty | pusty |
| verlangen | | требовать | to demand, require | żądać |
| die Sorge | f | забота, тревога | worry, care | troska |
| messen | | измерять | to measure | mierzyć |
| lieb | | милый, любимый | dear, kind | miły, drogi |
| historisch | | исторический | historical | historyczny |
| sinken | | опускаться, падать | to sink, to drop | opadać |
| stammen | | происходить (откуда-то) | to originate from | pochodzić |
| wieso | | почему, как так | why, how come | dlaczego |
| der Faktor | m | фактор | factor | czynnik |
| überraschen | | удивлять | to surprise | zaskakiwać |
| der Abschnitt | m | отрезок, раздел | section, segment | odcinek |
| die Nähe | f | близость, окрестность | proximity, vicinity | bliskość, okolica |
| zahlreich | | многочисленный | numerous | liczny |
| übrig | | оставшийся | remaining, left over | pozostały |
| die Produktion | f | производство | production | produkcja |
| drücken | | давить, нажимать | to press | naciskać |
| das Gas | n | газ | gas | gaz |
| die Hälfte | f | половина | half | połowa |
| der Kontakt | m | контакт | contact | kontakt |
| egal | | всё равно, безразлично | regardless, doesn't matter | obojętne |
| trennen | | разделять, разлучать | to separate | oddzielać |
| benötigen | | нуждаться, требоваться | to need, require | potrzebować |
| verhindern | | предотвращать | to prevent | zapobiegać |
| leiden | | страдать, переносить | to suffer | cierpieć |
| der Anspruch | m | претензия, требование | claim, demand | roszczenie |
| der Sport | m | спорт | sport | sport |
| die Medien | pl | СМИ | media | media |
| das Institut | n | институт | institute | instytut |
| das Tor | n | ворота, гол | gate, goal | brama, gol |
| der Betrieb | m | предприятие, работа | company, operation | przedsiębiorstwo, działanie |
| sich eignen | | подходить, годиться | to be suitable | nadawać się |
| die Klasse | f | класс | class | klasa |
| erlauben | | разрешать, позволять | to allow, permit | pozwalać |
| treiben | | гнать, заниматься | to drive, to do (sport) | gnać, uprawiać |
| unterwegs | | в пути, по дороге | on the way | w drodze |
| der Ausdruck | m | выражение, оборот речи | expression, term | wyrażenie |
| greifen | | хватать, тянуться | to grab, to reach | chwytać |
| die Tabelle | f | таблица | table (chart) | tabela |
| der Gewinn | m | выигрыш, прибыль | win, profit | wygrana, zysk |
| die Darstellung | f | представление, изображение | representation, depiction | przedstawienie |
| produzieren | | производить, выпускать | to produce | produkować |
| die Kritik | f | критика | criticism | krytyka |
| die Trainerin | f | тренер (женщина) | trainer, coach (female) | trenerka |
| melden | | сообщать, заявлять | to report, register | meldować |
| das Opfer | n | жертва | victim, sacrifice | ofiara |
| der Titel | m | заглавие, титул | title | tytuł |
| der Finger | m | палец (на руке) | finger | palec |
| total | | полностью, совершенно | totally | całkowicie |
| die Schulter | f | плечо | shoulder | ramię |
| der Schluss | m | конец, заключение | end, conclusion | koniec, wniosek |
| kulturell | | культурный | cultural | kulturalny |
| nötig | | необходимый | necessary | potrzebny |
| der Sieg | m | победа | victory | zwycięstwo |
| verantwortlich | | ответственный | responsible | odpowiedzialny |
| der Spaß | m | удовольствие, веселье | fun | zabawa |
| ernst | | серьёзный | serious | poważny |
| kämpfen | | бороться, сражаться | to fight | walczyć |
| heben | | поднимать | to lift, raise | podnosić |
| singen | | петь | to sing | śpiewać |
| die Theorie | f | теория | theory | teoria |
| der Inhalt | m | содержание | content | zawartość |
| der Rest | m | остаток | rest, remainder | reszta |
| riesig | | огромный, гигантский | huge, gigantic | ogromny |
| per | | посредством, через | per, by | za pomocą |
| wechseln | | менять | to change, switch | zmieniać |
| der König | m | король | king | król |
| das Ohr | n | ухо | ear | ucho |
| elektrisch | | электрический | electric | elektryczny |
| der Beitrag | m | вклад, статья | contribution, article | wkład, artykuł |
| einfallen | | приходить в голову | to come to mind | przyjść do głowy |
| verletzen | | ранить, повреждать | to injure, hurt | zranić |
| die Kontrolle | f | контроль | control, check | kontrola |
| schreien | | кричать | to shout, scream | krzyczeć |
| andererseits | | с другой стороны | on the other hand | z drugiej strony |
| der Besuch | m | визит, посещение | visit | wizyta, odwiedziny |
| typisch | | типичный | typical | typowy |
| das Gebiet | n | область, территория | area, region | obszar, dziedzina |
| die Organisation | f | организация | organization | organizacja |
| die Summe | f | сумма | sum | suma |
| ausreichen | | хватать, быть достаточным | to suffice, be enough | wystarczać |
| irgendein | | какой-то, любой | some, any | jakiś |
| benutzen | | пользоваться, использовать | to use | używać |
| vertrauen | | доверять | to trust | ufać |
| extrem | | экстремальный, крайний | extreme | ekstremalny |
| theoretisch | | теоретический | theoretical | teoretyczny |
| die Krankheit | f | болезнь | illness, disease | choroba |
| die Voraussetzung | f | предпосылка, условие | prerequisite | warunek |
| der Zeitpunkt | m | момент времени | point in time | moment, chwila |
| wenigstens | | хотя бы, по крайней мере | at least | przynajmniej |
| der Gang | m | ход, проход, передача | gait, hallway, gear | chód, korytarz, bieg |
| der Politiker | m | политик | politician (male) | polityk |
| die Politikerin | f | политик (женщина) | politician (female) | polityk (kobieta) |
| die Unterstützung | f | поддержка | support | wsparcie |
| brechen | | ломать, нарушать | to break | łamać |
| fassen | | хватать, вмещать | to grasp, to hold | chwytać, mieścić |
| entfernen | | удалять, убирать | to remove | usuwać |
| die Haut | f | кожа | skin | skóra |
| der Schutz | m | защита | protection | ochrona |
| das Zeichen | n | знак | sign | znak |
| die Wahrheit | f | истина, правда | truth | prawda |
| hinten | | сзади, позади | behind, at the back | z tyłu |
| auffallen | | привлекать внимание, бросаться в глаза | to stand out | rzucać się w oczy |
| der Gegensatz | m | противоположность | opposite, contrast | przeciwieństwo |
| verteilen | | распределять, раздавать | to distribute | rozdzielać |
| das Papier | n | бумага | paper | papier |
| vermutlich | | предположительно, вероятно | presumably | prawdopodobnie |
| falls | | если, в случае если | if, in case | jeśli |
| der Partner | m | партнёр | partner (male) | partner |
| die Partnerin | f | партнёрша | partner (female) | partnerka |
| nachdenken | | размышлять, обдумывать | to think over, ponder | zastanawiać się |
| der Wagen | m | машина, повозка | car, vehicle | samochód, wóz |
| das Schiff | n | корабль, судно | ship | statek |
| die Tat | f | действие, поступок | deed, act | czyn |
| der Stein | m | камень | stone | kamień |
| sich kümmern | | заботиться | to take care of | troszczyć się |
| die Erklärung | f | объяснение, заявление | explanation, declaration | wyjaśnienie |
| die Herausforderung | f | вызов, испытание | challenge | wyzwanie |
| starten | | стартовать, запускать | to start, launch | startować |
| staatlich | | государственный | state-, governmental | państwowy |
| die Qualität | f | качество | quality | jakość |
| der Rand | m | край, кромка | edge, margin | brzeg |
| gefährlich | | опасный | dangerous | niebezpieczny |
| zwingen | | принуждать | to force | zmuszać |
| das Bier | n | пиво | beer | piwo |
| komplett | | полный, полностью | complete(ly) | kompletny |
| die Forderung | f | требование | demand, claim | żądanie |
| stoßen | | толкать, наталкиваться | to push, to bump | popychać |
| umgehen | | обращаться, обходить | to handle, to bypass | obchodzić się, omijać |
| sich verlaufen | | заблудиться, разойтись | to get lost | zgubić się |
| böse | | злой, сердитый | angry, evil | zły |
| abhängen | | зависеть | to depend on | zależeć |
| die Geschwindigkeit | f | скорость | speed | prędkość |
| ideal | | идеальный | ideal | idealny |
| der Augenblick | m | мгновение, момент | moment, instant | chwila |
| reduzieren | | сокращать, уменьшать | to reduce | redukować |
| die Maschine | f | машина, аппарат | machine | maszyna |
| ausmachen | | составлять, выключать, договариваться | to make up, switch off, agree | stanowić, wyłączać, umawiać |
| eintreten | | входить, наступать | to enter, to occur | wchodzić, nastąpić |
| kritisch | | критический | critical | krytyczny |
| die Saison | f | сезон | season | sezon |
| genügen | | хватать, быть достаточным | to suffice | wystarczać |
| schieben | | толкать | to push, shove | pchać |
| die Nase | f | нос | nose | nos |
| vertreten | | представлять, замещать | to represent | reprezentować |
| dicht | | плотный, густой | dense, tight | gęsty |
| bereit | | готовый | ready | gotowy |
| die Technik | f | техника, технология | technology, technique | technika |
| das Blatt | n | лист | sheet, leaf | liść, kartka |
| der Fußball | m | футбол, футбольный мяч | football, soccer | piłka nożna |
| maximal | | максимальный | maximum | maksymalny |
| offiziell | | официальный | official | oficjalny |
| außen | | снаружи | outside | na zewnątrz |
| der Kreis | m | круг, район | circle, district | krąg, powiat |
| digital | | цифровой | digital | cyfrowy |
| organisieren | | организовывать | to organize | organizować |
| verzichten | | отказываться (от чего-то) | to do without, renounce | rezygnować |
| bemerken | | замечать | to notice, remark | zauważać |
| still | | тихий | quiet, still | cichy |
| der Vertreter | m | представитель | representative (male) | przedstawiciel |
| die Vertreterin | f | представительница | representative (female) | przedstawicielka |
| der Gegenstand | m | предмет | object, item | przedmiot |
| die Zusammenarbeit | f | сотрудничество | cooperation | współpraca |
| landen | | приземляться | to land | lądować |
| die See | f | море | sea | morze |
| der Tourist | m | турист | tourist (male) | turysta |
| die Touristin | f | туристка | tourist (female) | turystka |
| verbieten | | запрещать | to forbid, prohibit | zakazywać |
| finanziell | | финансовый | financial | finansowy |
