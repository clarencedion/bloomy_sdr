# Runner social (Instagram / Facebook)

Le runner envoie les DM préparés par le SDR depuis **le compte Instagram ou Facebook de l'entreprise**, dans une vraie fenêtre de navigateur, sur ton Mac. Il ouvre la conversation et tape le message ; **c'est toi qui envoies, message par message, avec la touche Entrée**. Il relève aussi les réponses des prospects et te propose une réponse, que tu envoies de la même façon.

Par défaut, rien ne part sans ta touche Entrée pour ce message-là. Pour les **premiers DM** seulement, tu peux lancer une **session automatique** (`--auto`, voir plus bas) : chaque message part alors à la fin d'un compte à rebours, sans touche. Les réponses aux prospects attendent toujours ta touche.

## Installation (une fois)

Prérequis : Node 22 ou plus récent, et l'accès Google Cloud déjà configuré sur ce Mac (`gcloud auth application-default login`), comme pour les autres scripts du projet.

```bash
npm run social:install
```

Cette commande installe `playwright-core` (version figée 1.61.1) dans `social-runner/` et enregistre le navigateur Chromium de Playwright. S'il est déjà présent sur le Mac, rien n'est téléchargé.

## Première connexion (une fois par entreprise et par réseau)

```bash
npm run social:login -- --business biz_bloomy --network instagram
npm run social:login -- --business biz_bloomy --network facebook
```

Une fenêtre s'ouvre. Connecte-toi avec le compte de l'entreprise, double authentification comprise. Pour Facebook, bascule ensuite sur le **profil de la Page** : les messages partiront en son nom. Reviens au terminal et appuie sur Entrée. Le runner affiche le compte qu'il voit connecté.

La session reste enregistrée dans un profil de navigateur dédié. Tu n'as pas à te reconnecter à chaque fois.

## Au démarrage de chaque session (send et inbox)

1. Le runner ouvre la page d'accueil du réseau. Une page de connexion ou une vérification de sécurité arrête tout de suite la session.
2. Il lit le compte connecté dans la fenêtre (le @ Instagram, ou le nom du profil actif sur Facebook). Si le compte de l'entreprise est renseigné dans ses réglages (`socialAccounts`) et que la fenêtre agit sous **un autre compte**, il refuse de démarrer : sinon, les DM partiraient de ton profil personnel et les réponses arriveraient ailleurs.
3. Il te demande de confirmer le compte avec **O** (Q pour arrêter), même quand il l'a reconnu.

**Garde le terminal au premier plan.** Au lancement, la fenêtre du navigateur prend souvent le focus. Clique dans le terminal avant d'appuyer sur O, et reste-y : une touche tapée dans la fenêtre du navigateur part sur la page. Le runner retire le curseur du champ de message après l'avoir rempli, donc une Entrée tapée par erreur dans la fenêtre n'envoie rien. Si tu as cliqué dans le champ et que le message est parti depuis la fenêtre, le runner s'en aperçoit à ta touche suivante (quelle qu'elle soit), l'enregistre comme envoyé et ne le renvoie jamais.

## Répétition (sans rien envoyer)

```
npm run social:rehearse -- --business biz_bloomy --network instagram
```

Ouvre les 3 premières conversations de la file (`--max N`, jusqu'à 10) sur le vrai compte : contrôle de contact, page du prospect, bouton « Message », champ de message, et — sur Instagram — si la conversation est vierge (ce qu'une session automatique vérifie avant d'écrire). Ne tape rien, n'envoie rien, n'enregistre rien dans le SDR et ne demande aucune touche. À lancer avant la première session, ou quand Instagram ou Facebook change ses pages. S'arrête au premier blocage, comme une vraie session.

## Tous les jours

### Envoyer les premiers DM

```bash
npm run social:send -- --business biz_bloomy --network instagram
npm run social:send -- --business biz_bloomy --network facebook --max 10
```

Le runner prend les brouillons de DM du SDR pour ce réseau. Pour chaque prospect, il :

1. vérifie que l'entreprise peut encore être contactée (liste d'exclusion, un seul premier DM par entreprise, tous canaux confondus) ;
2. ouvre son profil, clique sur « Message » et tape le texte ;
3. relit le champ, puis t'affiche le texte et les avertissements : **rouge** si le contrôle des prix a échoué, **orange** si le message parle de conditions commerciales.

Ensuite, à toi :

| Touche | Effet |
|---|---|
| **Entrée** | envoyer ce message. Si le contrôle des prix est en rouge, le runner demande ensuite **O** (envoyer quand même) ou **N** (revenir) : une seconde Entrée ne suffit pas |
| **E** | modifier le texte dans le terminal (`\n` = retour à la ligne), puis le runner le retape |
| **S** | passer ce prospect (il revient dans 24 h) |
| **Q** ou **Ctrl+C** | arrêter la session proprement |

Le runner tape le texte qui est enregistré dans le SDR **au moment d'ouvrir la conversation** : une correction enregistrée sur la page Approbations pendant la session est prise en compte.

Après Entrée, le runner vérifie à nouveau l'exclusion, le plafond du jour et l'espacement minimum entre deux DM, puis :

1. note l'envoi sur ce Mac (`social-runner/.state/pending-sends/`) **avant** d'appuyer sur Entrée dans la page ;
2. envoie, puis regarde la conversation : la bulle doit apparaître **et rester sans « Échec de l'envoi » / « Not delivered » / « Envoi… »** pendant quelques secondes ;
3. vérifie à nouveau la page (« réessayez plus tard », « action bloquée ») ;
4. enregistre l'envoi dans le SDR (Inbox, entonnoir, statistiques), en réessayant si le SDR ne répond pas, puis efface la note.

Si Meta marque la bulle comme non envoyée, ou affiche un blocage juste après l'envoi, le message est enregistré « à vérifier » et **la session s'arrête**.

Par défaut : **30 DM par jour et par réseau, au moins 45 secondes entre deux envois.** Ces valeurs se règlent par entreprise (`socialLimits` dans les réglages de l'entreprise). Si l'espacement n'est pas encore écoulé, un compte à rebours s'affiche ; S ou Q l'interrompent.

### Session automatique (premiers DM, Instagram seulement)

```bash
npm run social:send -- --business biz_bloomy --network instagram --auto --max 3
npm run social:send -- --business biz_bloomy --network instagram --auto
```

C'est la même session, avec les mêmes contrôles, mais **sans touche par message** : le runner tape le message, l'affiche, et l'envoie à la fin d'un compte à rebours de 10 secondes (`--veto 30` pour 30 secondes, de 5 à 300). Pendant le compte à rebours, **S** passe ce prospect et **Q** arrête la session ; **Ctrl+C** l'arrête à tout moment, jusqu'à l'instant de l'envoi. Tu confirmes toujours le compte avec **O** au démarrage : c'est toi qui lances la session, dans un terminal.

Ce qu'une session automatique n'envoie pas :

- un DM que **le SDR n'autorise pas à partir sans relecture** : contrôle des prix en rouge, avertissement, brouillon jamais contrôlé, conditions commerciales qui ne sont pas la phrase de l'offre placée par le code, ou chiffre sur le prospect qui ne correspond pas aux preuves vérifiées (nombre d'avis, note, année, tout nombre — et toute quantité écrite en lettres, comme « près de mille avis », qu'on ne peut pas comparer). Il n'est ni ouvert ni tapé : il reste dans la file et te sera proposé dans une session normale (sans `--auto`) ;
- un « premier » message dans une **conversation déjà entamée** (ou qu'il ne peut pas vérifier) : le SDR ne connaît que ses propres envois, pas ceux que tu as faits à la main ou avec un autre outil. Rien n'est tapé ; le DM reste dans la file des sessions normales (où tu vois la conversation), et les sessions automatiques ne rouvriront plus ce profil ;
- quoi que ce soit si **le SDR est en pause** ou en mode test (réglages de l'application). L'interrupteur « pause » de l'application arrête une session automatique en cours à son prochain message ;
- quoi que ce soit pendant **48 heures après un blocage** d'Instagram sur une session de cette entreprise (page de connexion, vérification, « action bloquée ») ;
- une **réponse** à un prospect : `social:inbox` n'a pas de mode automatique ;
- sur **Facebook** : pas de mode automatique pour l'instant.

Elle **s'arrête d'elle-même**, sans rien retenter et sans jamais retaper un message :

- au premier blocage ou message d'erreur de Meta (comme toute session) ;
- au premier envoi qu'elle ne voit pas apparaître dans la conversation (enregistré « à vérifier ») ;
- si le texte quitte le champ de message sans que l'envoi soit visible (une touche tapée dans la fenêtre, une discussion fermée) : il est **peut-être parti**, donc enregistré « à vérifier » et jamais renvoyé ;
- si le champ ne contient pas exactement le texte prévu, ou si la conversation n'est plus vierge au moment d'envoyer ;
- après 3 conversations de suite « déjà entamées ou non vérifiables » (signe que la vérification ne reconnaît plus la fenêtre d'Instagram) ;
- au plafond du jour, et après 3 prospects sans bouton « Message ».

Pour passer un prospect pendant le compte à rebours, appuie sur **S** dans le terminal. Ne vide pas le champ à la main dans la fenêtre : un texte qui disparaît du champ sans envoi visible est enregistré « à vérifier », parce qu'on ne peut pas le distinguer d'un message parti.

**Après un arrêt sur un doute** (envoi non confirmé, texte mal saisi, conversation à vérifier, erreur, session interrompue brutalement), le mode automatique reste coupé : regarde la conversation concernée dans la fenêtre, puis lance une session normale (sans `--auto`), envoie ou passe au moins un message, et termine-la. Le mode automatique redevient disponible ensuite.

Le plafond (30 par jour) et l'espacement (45 s) sont les mêmes. Chaque DM envoyé ainsi est marqué « envoi automatique » dans le SDR (`sentAuto`, journal d'activité).

**Le risque est le tien.** Meta interdit l'envoi automatisé de messages et peut restreindre ou fermer un compte qui s'en sert, sans prévenir. Le runner ne cherche pas à passer inaperçu (pas de mode furtif, pas de proxy, pas de délais aléatoires, pas de contournement de CAPTCHA) : s'il est repéré, il s'arrête et c'est le compte connecté qui en porte la conséquence. Préfère un compte au nom de l'entreprise à ton compte personnel, commence par `--max 3` en regardant la fenêtre, et garde un volume bas.

### Relever les réponses

```bash
npm run social:inbox -- --business biz_bloomy --network instagram
```

Le runner ouvre la boîte de réception et repère les fils des prospects contactés. Il n'ouvre que ceux où le prospect a écrit en dernier, plus ceux qui **attendent encore ta réponse** (une proposition passée avec S, une session interrompue, un message signalé « à traiter par toi »), même si leur fil n'est plus visible dans la liste. Un fil repéré dans la liste sans rien de sûr à cliquer est ouvert par son adresse quand le SDR la connaît ; sinon il n'est jamais cliqué au hasard. Il lit ensuite les nouveaux messages et les transmet au SDR, qui :

- **enregistre une demande de désinscription** (« stop », « ne plus me contacter »…) : le prospect n'est plus jamais contacté ;
- **ignore les réponses automatiques** ;
- **te laisse la main** sur un message sensible (colère, risque juridique) : tu peux écrire la réponse toi-même (E) ou passer (S) ;
- sinon **propose une réponse** fondée sur l'offre, avec les mêmes contrôles de prix.

Pour une proposition : **Entrée** envoie, **E** modifie, **R** demande une autre proposition, **S** passe (la proposition reste dans le SDR et **te sera reproposée au prochain passage**), **Q** arrête.

Une réponse en attente n'est reproposée que si le prospect est toujours le dernier à avoir écrit dans le fil. Si c'est toi (réponse envoyée à la main), le runner te le signale et ne propose rien : regarde la conversation dans l'Inbox du SDR.

Les réponses ne comptent ni dans le plafond du jour ni dans l'espacement. L'exclusion est vérifiée juste avant chaque envoi, sur la conversation relue à cet instant.

Si l'IA ou le SDR ne répond pas pour un fil (délai dépassé, réponse illisible), ce fil est passé avec un message et repris au prochain passage ; le relevé continue avec les autres. Trois échecs de suite arrêtent le relevé. Ce n'est jamais présenté comme un blocage Meta.

## Ce que le runner ne fait jamais

- Envoyer sans ta touche Entrée, sauf dans une session automatique que tu as lancée toi-même avec `--auto` (premiers DM dont tous les contrôles sont validés). Jamais en tâche de fond : il refuse de démarrer hors d'un vrai terminal. Jamais une réponse à un prospect sans ta touche.
- Contourner une page de connexion, une vérification de sécurité (« confirmez qu'il s'agit bien de vous »), un CAPTCHA ou un message « réessayez plus tard » / « action bloquée ». **Il s'arrête net**, l'indique ici et dans le SDR. C'est à toi de régler la situation dans la fenêtre, puis de relancer plus tard.
- Utiliser des plugins furtifs, des proxys, plusieurs comptes, ou des relances automatiques par DM.
- Contacter deux fois la même entreprise en premier message, ou quelqu'un qui a demandé à ne plus l'être.
- Lire autre chose que les fils des prospects contactés. Les messages des prospects sont traités comme des données, jamais comme des instructions.

## Journal de session

Tout ce que le terminal affiche pendant une session (send, inbox, rehearse) est aussi écrit dans un fichier de `social-runner/.state/logs/`, dont le chemin est affiché au démarrage. Il contient les textes des brouillons et les noms des prospects : il reste sur ce Mac (dossier ignoré par git). Il sert à relire une session après coup sans recopier le terminal.

## Le dossier du profil est sensible

Le profil du navigateur est rangé ici :

```
~/Library/Application Support/devcomm-sdr/profiles/<entreprise>/chromium
```

Il contient la **session connectée** du compte Instagram / Facebook. Quiconque le copie peut agir au nom de l'entreprise. Ne le copie pas, ne le partage pas, ne le mets pas dans un dossier synchronisé (iCloud, Drive). Pour déconnecter le runner, supprime ce dossier.

Avec l'option `--chrome`, le runner utilise Google Chrome installé, avec son propre dossier (`.../chrome`). Ce n'est jamais ton profil Chrome habituel.

## Arrêter

- **Q** à n'importe quelle question : le champ de message est vidé et la session se termine proprement.
- **Ctrl+C** : même effet, à la prochaine étape. Le runner n'ouvre plus aucun prospect ni aucun fil après un Ctrl+C. Un second Ctrl+C force l'arrêt.

Dans tous les cas, le runner enregistre la fin de session dans le SDR et ferme le navigateur proprement, pour conserver la connexion.

Si la session s'arrête brutalement juste après une Entrée (second Ctrl+C, terminal fermé, panne du SDR), la note prise avant l'envoi reste sur ce Mac. **Au démarrage suivant**, le runner l'enregistre dans le SDR « à vérifier » (sans jamais renvoyer le message) et ne repropose pas ce prospect. Si le SDR refuse encore, le prospect reste hors de la file et le runner affiche le chemin de la note.

## Dépannage

- **« Ce profil est déjà ouvert »** : une autre fenêtre du runner (ou Chrome) utilise ce profil. Ferme-la, puis relance.
- **« Page de connexion »** : la session a expiré. Relance `social:login`.
- **« Vérification de sécurité », « CAPTCHA », « réessayez plus tard », « action bloquée »** : règle-le dans la fenêtre, puis attends avant de relancer. Ne relance pas en boucle.
- **« no_message_button », « no_composer », « Conversation introuvable »** : le runner ne clique jamais au hasard. Un prospect isolé est mis de côté pour 24 h (un fil introuvable est ignoré pour ce passage) et la session continue. **Trois de suite** veulent dire qu'Instagram ou Facebook a changé son interface : la session s'arrête (`selector_drift`) et le dernier DM reste dans la file. Les libellés et sélecteurs sont regroupés dans un seul fichier par réseau : `src/drivers/instagram-driver.mjs` et `src/drivers/facebook-driver.mjs`.
- **Une erreur de délai (Timeout) ou une autre erreur** : la session s'arrête avec l'erreur. Ce n'est présenté comme un blocage Meta que si la page affiche vraiment un blocage.
- **« La fenêtre agit en tant que … mais … est réglée sur … »** : le compte connecté n'est pas celui de l'entreprise. Bascule sur la Page (Facebook) ou reconnecte le bon compte avec `social:login`, ou corrige `socialAccounts` dans les réglages de l'entreprise.
- **« La fenêtre n'est pas connectée »** : relance `social:login`.
- **« La fenêtre de discussion de ce prospect a changé ou s'est fermée »** : rien n'est parti, la session s'arrête. Ferme les fenêtres de discussion ouvertes, puis relance.
- **`chat_window_already_open` ou `several_chat_windows_open` (Facebook)** : une fenêtre de discussion Messenger est restée ouverte, et le runner refuse de taper sans savoir à qui. Ferme les bulles de discussion en bas de la page, puis relance.
- **« Envoi non confirmé à l'écran »** : le message est enregistré « à vérifier ». Regarde la conversation dans la fenêtre.
- **« Meta n'a pas accepté l'envoi »** : la bulle porte « Échec de l'envoi » / « Not delivered », ou un blocage est apparu juste après l'envoi. Le message est enregistré « à vérifier » et la session s'arrête. Attends avant de relancer.
- **« Message envoyé mais NON enregistré »** : le message est parti, mais le SDR n'a pas pu l'enregistrer malgré plusieurs essais (connexion, ou entreprise déjà contactée entre-temps). La session s'arrête. La note reste sur ce Mac et sera enregistrée « à vérifier » au prochain démarrage ; vérifie le prospect dans le SDR.
- **« … envoi(s) d'une session précédente n'ont pas été enregistrés »** (au démarrage) : voir « Arrêter » ci-dessus. Les notes sont dans `social-runner/.state/pending-sends/` (ignoré par git) ; n'en supprime une que si tu as vérifié le prospect dans le SDR.
- **« … message(s) du prospect lu(s) par l'IA mais introuvable(s) tel(s) quel(s) sur la page »** (inbox) : le SDR ne garde un message du prospect que s'il le retrouve sur la page, pour ne jamais enregistrer ni répondre à un texte inventé ou reformulé par l'IA. Ce qui est écarté n'est ni enregistré ni répondu : lis ce fil toi-même dans la fenêtre. Le total s'affiche dans le bilan de fin de session.
- **« Aucun modèle IA réel n'est configuré »** (inbox) : ajoute la clé Qwen ou Anthropic dans les réglages du SDR.
- **« Le fournisseur IA actif (openai) ne sait pas lire les fils »** (inbox) : choisis Qwen ou Anthropic dans les réglages du SDR.
- **« Module SDR introuvable »** : les scripts `social:send` et `social:inbox` recompilent le backend avant de démarrer. Sinon, lance `npm run --prefix functions build`.

## Pour les développeurs

- `bin/run.mjs` : la ligne de commande (`login`, `send`, `inbox`).
- `src/sdr.mjs` est **le seul** module qui appelle le backend (`functions/lib`), via `src/bootstrap.mjs`. Celui-ci refuse tout autre projet que `devcomm-os` et tout émulateur.
- `src/session-machine.mjs` et `src/inbox-flow.mjs` portent la logique. Ils n'importent ni Playwright, ni Firebase, ni le terminal. Le seul envoi passe par `sendFromComposer` (`src/composer.mjs`), après la touche Entrée pour ce message. Avant d'agir sur n'importe quelle touche, ils vérifient si le message est déjà parti depuis la fenêtre du navigateur.
- `src/session-start.mjs` : page d'accueil, connexion, compte actif (`src/identity.mjs`), confirmation O.
- `src/send-journal.mjs` : la note locale prise avant chaque envoi et rejouée au démarrage suivant.
- `src/pending-state.mjs` : ce qu'une conversation attend encore (proposition non envoyée, message signalé) et la vérification du fournisseur IA.
- `src/composer.mjs` ne tape jamais de saut de ligne comme une touche, car Entrée enverrait le message : il utilise `insertText` ligne par ligne et `Shift+Entrée` entre les lignes, puis retire le focus du champ.
- Les pilotes (`src/drivers/`) fixent le champ de message à son élément au moment d'ouvrir la conversation (`pinComposer`) : une fenêtre de discussion qui s'ouvre ensuite ne peut pas prendre sa place. La vérification de l'envoi lit la bulle dans cette conversation seulement.
- Les tests tournent hors ligne, sans navigateur ni Firestore, avec le `MockSocialChannelDriver` :

```bash
GOOGLE_CLOUD_PROJECT=demo-sdr-offline GCLOUD_PROJECT=demo-sdr-offline FIRESTORE_EMULATOR_HOST=127.0.0.1:9 npx vitest run social-runner/test
```
