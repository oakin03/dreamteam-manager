// Guide (English; Filipino is looked up from these texts). Each section: what it is for,
// step by step, buttons, rules, tips and what to do when something goes wrong.
export const GUIDE_EN = {
  title: "Guide",
  subtitle: "The user manual: what each page is for, how to use it and how it works",
  search: "Search the guide…",
  empty: "No topic matches the search.",
  head: { what: "What is it for?", steps: "Step by step", buttons: "Buttons and fields", rules: "How does it work?", tips: "Tips", problems: "If something goes wrong" },
  intro: "DreamTeam Manager does the repetitive work of the game for you: it plays matches, finishes the daily tasks, signs players from Scout and trades them between accounts, collects market sales and plays modes like PVP, Tower and Go-up. Most of it runs in the background without a browser, and everything it does is written to the Activity page. If you are new, read “Getting started” and “Basic terms” first.",
  sections: [
    {
      id: "start", icon: "🚀", name: "Getting started",
      what: "The shortest way for a first-time user: add the accounts, choose the main account, give roles, then start the automations.",
      steps: [
        "On the Accounts page add your game accounts with “Add Account” (username and password). For many new accounts use “Create accounts”.",
        "Make your main account (the one collecting cards) Main with “Make Main”. The other accounts become Side.",
        "If needed, give accounts a role in the Role column: Harcayıcı (spender), Tournament, 2nd Main… (see “Basic terms”).",
        "On the Cards page press “Refresh” to scan the main account's cards, then give players the Card / Sellable / Stock roles in the Player List. Auto Trade decides what to sign from these roles.",
        "On the Auto Play page select accounts and press “Start selected”: they start playing matches and doing the daily routine.",
        "Turn on the Daily plan switches (Auto Play daily stop, tournament registration, PVP) to have them done every day.",
        "When something goes wrong, look at the Activity page first."
      ],
      buttons: [], rules: [],
      tips: [
        "Open the app with the DreamTeam Manager shortcut on the desktop or in the Start menu. If the app is already open, the shortcut brings the open window to the front.",
        "Whether the app keeps running in the tray when the window is closed is set in Settings → App behaviour."
      ],
      problems: []
    },
    {
      id: "concepts", icon: "📘", name: "Basic terms",
      what: "The words used all over this guide and the app.",
      steps: [],
      buttons: [
        ["Main (main account)", "The account collecting cards. Auto Trade moves Card-role players here and turns them into cards; Cards, Synthesis and Activate work with this account."],
        ["2nd Main", "A spare main account that acts as main while no Main account is chosen."],
        ["Side (side account)", "Every account other than Main. All roles other than Main (Tournament, Harcayıcı, your own) count as Side in the other automations."],
        ["Harcayıcı (spender)", "Side accounts that sign Sellable / Stock players in Auto Trade and put them on the market. They spend their own TK on it, so the TK of Main and the other sides is kept."],
        ["Card role", "A player that goes to Main and is turned into a star card."],
        ["Sellable role", "A player that stays on a side account and is sold on the market."],
        ["Stock role", "A player kept on a side account. Only accounts at level 30 or higher sign them (those accounts may get a 5% salary discount)."],
        ["Cheap player", "A player whose price is under Auto Trade's “Maximum price”: it goes to Main and becomes a card whatever its role."],
        ["Value and Base", "Value is the player's worth today; Base is the floor it can fall to. A player whose salary is at or below its Base gets a BASE badge. When the value falls below Base, tomorrow's Base is the value minus 5%."],
        ["TK, APK, TIX", "The game's three currencies. Scout signings and trades use TK; market listings use APK or TIX."],
        ["Bench", "The 6 players after the starting five. A roster holds at most 5 + 6 = 11 players; the automations never touch the starting five."]
      ],
      rules: [
        "The game day turns at 19:00 (TR); daily attempts (PVP, Daily Boss, Cheer, tasks) reset at 19:10.",
        "Player values change every day at 11:00 (TR); the app reads the new list around 11:05.",
        "Tournaments start every day at 15:00 (TR).",
        "Some work needs a sign-in to the account. When the app signs in, the account is signed out wherever else it is open (e.g. a game tab in the browser). Reading (Scout list, mail, friends) needs no sign-in."
      ],
      tips: [], problems: []
    },
    {
      id: "general", icon: "💡", name: "Everyday use",
      what: "Conveniences that work everywhere in the app.",
      steps: [],
      buttons: [
        ["Table headers", "Click a column header to sort by it; again to flip, a third time for the original order. Numbers, dates and grades (D- … S+) sort in the right order."],
        ["Stop all automations", "The button at the bottom left stops everything. “Resume” starts the same work again."],
        ["Yellow bar", "Shown when the game cannot be reached. Everything waits and continues by itself when the game is back."],
        ["Account groups", "At least 3 accounts with the same name and a number at the end (Pipelne1–50, Trophy–Trophy10) show as one group. The group's box selects them all, its name opens it; open groups are remembered."]
      ],
      rules: [
        "Every automation that plays matches (PVP, Tower, Go-up, Quiz, Daily Boss…) stops Auto Play on its accounts first and starts it again afterwards.",
        "When you work on an account by hand (a market listing, a fire), an automation using that account waits only for that account and goes on with the others.",
        "Tower, PVP, Go-up, Daily Quiz, Synthesis, relisting, Chat and Auto Trade show a Windows notification when they finish."
      ],
      tips: [
        "Numbers in the sidebar: accounts running Auto Play (blue), market sales waiting to be claimed (green), errors since you last looked (red), Social requests + unread messages (red; an orange ! for mail with rewards only).",
        "The sidebar layout (list names, order) can be changed in Settings → Menu layout."
      ],
      problems: []
    },
    {
      id: "home", icon: "🏠", name: "Command Center",
      what: "The main screen. It shows every account at a glance: is the game up, how many accounts run Auto Play, which accounts have a problem, how long until the day turns.",
      steps: [
        "Check the game status, running accounts and accounts with problems on the top line.",
        "Click a summary box (Daily Reward, PVP attempts, Social, task rewards waiting) to open its page.",
        "Accounts with problems are at the top of the accounts table; clicking a row opens that account in Auto Play."
      ],
      buttons: [
        ["Today's timeline", "Daily stop, tournament registration, PVP, salary update, day turn and scheduled tasks on a time line; the orange line is now."],
        ["Accounts table", "Daily Reward 6 boxes (orange: claimed, green: can be claimed now), PVP attempts, salary / salary cap bar and TK."],
        ["Account health ⚙", "Changes the warning limits: lowest TK, at what percent of the salary cap to warn, roster size."],
        ["Check now", "Reads salary, roster and TK of every account now (normally every 10 minutes)."],
        ["Daily summary", "Matches played, sales claimed, purchases, syntheses and errors of the chosen day."],
        ["Fallen to Base", "Players at or below Base after 5% off their value (those under 75 TK are not shown); the newest first."]
      ],
      rules: [
        "Accounts over the salary cap show in red; Auto Play and Tower cannot start matches on them.",
        "An account with the game's market lock on gets a “Market locked” warning; no market work is possible there.",
        "The game's team logos are shown next to the accounts."
      ],
      tips: ["The details of a red warning are on the Activity page."],
      problems: []
    },
    {
      id: "accounts", icon: "👥", name: "Accounts",
      what: "Where you add, edit and remove game accounts and give them roles. The main account (Main) is chosen here.",
      steps: [
        "Press “Add Account”, enter the username and password, save.",
        "Press “Make Main” on the main account's row.",
        "Give each account a role in the Role column; use “Roles” to add a role or pick colours.",
        "Drag rows to change the order; the other pages use the same order."
      ],
      buttons: [
        ["Add Account", "Adds an account with username and password."],
        ["Edit / Delete", "Changes or removes an account."],
        ["Make Main", "Makes this the main account."],
        ["Refresh", "Reads level, TK, APK and TIX again."],
        ["Roles", "Adds and removes roles and picks their colour. Main, 2nd Main and Side are fixed: they cannot be removed or renamed."],
        ["Create accounts", "Asks for a prefix, the number of accounts, a common password and a logo, and opens the accounts in bulk (below)."]
      ],
      rules: [
        "Passwords are stored encrypted on this computer.",
        "Usable APK / TIX: what would be left if everything were moved to main. On side accounts the 5% cut is rounded up (at least 3); main has no cut.",
        "Create accounts: a temporary mail address is taken for each account, the account is opened in the game, the team name is prefix + number, the team is built and the logo chosen; the account is added to the daily routine and its Auto Play started.",
        "Accounts are opened 1, 5 or 10 at a time. Numbers continue from the highest one used with that prefix; names taken in the game are skipped.",
        "If the game or the mail site refuses, or 5 accounts in a row fail, it stops instead of forcing. If the app closes halfway, it continues on the next start."
      ],
      tips: [
        "Accounts sign in without a browser, with the game's own sign-in request; a browser opens only when that fails. This keeps the computer light when many accounts run.",
        "Level, TK, TIX and APK are read every 3 minutes even without Auto Play; a level-up is written to Activity."
      ],
      problems: [
        ["An account keeps opening with a browser", "After 3 errors in a row it tries the sign-in without a browser again. Check its password with Edit."]
      ]
    },
    {
      id: "social", icon: "💬", name: "Social",
      what: "Every account's inbox, friends, private chats, friend requests and blocked players on one page.",
      steps: [
        "Pick an account in the strip at the top. A red number is requests + unread messages, ✉ is mail with rewards.",
        "Choose a tab: Inbox, Friends, Chat, Requests, Blocked."
      ],
      buttons: [
        ["Inbox · Claim / Claim all", "Collects mail rewards; clicking a mail opens it."],
        ["Friends · Chat / Remove", "Opens the chat or removes the friend (asks first)."],
        ["Friends · Scout", "Opens that friend's free agent board (6 players, renewed every 30 minutes); players can be signed there."],
        ["Chat", "Pick a friend on the left, read and write."],
        ["Requests", "Accept or decline incoming requests; cancel your pending ones. The search looks among your own accounts."],
        ["Blocked · Unblock", "Unblocks a player."]
      ],
      rules: [
        "Reading needs no sign-in; sending messages and accepting requests use the account's own session, so it is not signed out of the game.",
        "Every minute the app looks for new requests, unread messages and mail with rewards on all accounts; if there are any, a number shows in the sidebar, Activity gets an entry and Windows shows a notification.",
        "The game deletes its chat history every day around 19:00; the app keeps what it has seen, so yesterday's chat can still be read.",
        "While Auto Play runs, mail rewards are also collected every 30 minutes."
      ],
      tips: [], problems: []
    },
    {
      id: "autoplay", icon: "▶️", name: "Auto Play",
      what: "Plays matches on the selected accounts and does the daily routine every day: Daily Signin, 600-Day sign-in, daily tasks, a 100 TK donation on accounts in an alliance, one Friendly Match and collecting the task rewards.",
      steps: [
        "Tick accounts in the table (or pick a group / roles at the top).",
        "Press “Start selected”. For one account use ▶ on its row.",
        "The Status column shows what the account is doing and its last opponent.",
        "To stop at the same time every day, turn on “Daily stop” in the Daily plan and pick the time."
      ],
      buttons: [
        ["▶ / ■", "Starts or stops one account."],
        ["Start / Stop selected", "All ticked accounts at once."],
        ["Start selected roles", "Starts the accounts in the roles chosen in the role menu; the choice is remembered."],
        ["Filter tabs and search", "All / Running / Stopped / With problems; the search filters by account name."],
        ["Claim rewards", "Collects the rewards of finished daily tasks and the mail now."],
        ["Refresh tasks", "Reads the Tasks column again."],
        ["Schedule", "Sets a task for a later time (see Scheduled tasks)."],
        ["Daily plan · Daily stop", "Stops every Auto Play at the chosen time each day (default 14:55, before the tournament); can start the same accounts again at another time."],
        ["Daily plan · Tournament", "Registers for the tournament every day at the chosen time (default 15:48)."],
        ["Daily plan · PVP", "Starts PVP Arena every day at the chosen time (default 05:01)."],
        ["Daily Reward switch", "When on, the Stadium's Daily Reward gift is collected when due even on accounts not running Auto Play."]
      ],
      rules: [
        "The daily routine runs on the first start after 19:10, or at 19:12 while running.",
        "Accounts search Quick Play one after another, so your own accounts do not meet each other. An opponent that is one of your accounts shows in orange.",
        "If the team goes over the salary cap, Auto Play stops on that account and warns you.",
        "When the daily PK limit is reached, Quick Play waits on that account until the 19:00 reset.",
        "Daily Reward has 6 steps a day; the table shows e.g. “4/6 01:23:45” (next step and time left), and waits for 19:00 at 6/6.",
        "The alliance donation is made once a day; it is skipped that day if TK is short or the account has just joined the alliance.",
        "The three Daily plan lines are independent; the Tournament and PVP lines use the accounts last chosen on their pages."
      ],
      tips: [
        "“Daily” shows whether today's routine is done; “Tasks” shows tasks left / total.",
        "On a new account the Daily Signin streak (“Start my streak”) is started by itself."
      ],
      problems: [
        ["An account stopped with “Salary cap”", "The team's total salary is over the game's limit. Sell or fire a bench player, then start again."],
        ["An account keeps showing “in a match”", "If the account is already in a match, the app waits for it to end and then goes on."]
      ]
    },
    {
      id: "schedule", icon: "⏰", name: "Scheduled tasks",
      what: "Sets a job for a later time: tournament registration, claiming market sales, relisting yesterday's listings or PVP Arena.",
      steps: [
        "Press “Schedule” on the Auto Play page.",
        "Choose the task, the time, the accounts and “Parallel / One by one”, then save.",
        "Waiting tasks are listed; you can delete them."
      ],
      buttons: [
        ["Task", "Tournament registration, Market: claim sales, Market: relist yesterday's listings, PVP Arena."],
        ["Parallel / One by one", "Run the accounts together or one after another."]
      ],
      rules: [
        "When the time comes, whatever runs on the chosen accounts is stopped, the preparation time passes, the task runs, and the stopped work starts again afterwards.",
        "If the app closes during a task, the stopped work is started again on the next start.",
        "The tournament and PVP lines of the Daily plan add a one-time task here every day."
      ],
      tips: [], problems: []
    },
    {
      id: "autotrade", icon: "🔁", name: "Auto Trade",
      what: "Signs suitable players from Scout and moves them with trades to the right account: Card-role and cheap players go to Main and become cards; Sellable / Stock players stay on side accounts or spenders (Harcayıcı) and go on the market. The starting five are never touched.",
      steps: [
        "First give players their roles on the Cards page (Card, Sellable, Stock). Auto Trade signs only players whose role or price fits.",
        "Choose the accounts in Accounts. If Main is not ticked, pick the account acting as main for this run.",
        "In Roles choose which role goes which way: Side → Main (to become cards), Main → Side (to stay on side accounts).",
        "Enter the maximum price: players at or under it go to Main and become cards whatever their role (under 50 = roles only).",
        "Enter the trade room name and password; choose the Loop (Single run, A number of runs, Endless) and how many accounts work at the same time (1–6, 3 recommended).",
        "To use spenders turn on “Use friends' Scouts” and set the TK floor. Enter the sale prices in the “Auto Pricing” tab.",
        "Press “Start”. You are warned if another system uses these accounts; “Stop and start” goes on.",
        "For accounts that already have bench players, decide per player: List on market, Include in trade, Turn into card, Fire or Do nothing. Players with salary 1 that cannot be traded only have Fire and Do nothing. These decisions are done for all accounts together before any Scout; a player that comes to the bench later is left alone.",
        "Only prepare: in the same window this button applies the bench decisions without starting Auto Trade. Started within an hour, these accounts are not checked again.",
        "Follow the work in Live status. At the end sell what is left on the sides with “List on market”."
      ],
      buttons: [
        ["Start / Pause / Resume", "Pause holds the work at a safe point; while it waits the spenders list the players they hold (cheap players are left alone). Resume continues from there."],
        ["Stop / Continue where it stopped", "Stops; before that the cheap players waiting for main on the sides go to main (fired when main's TK is not enough) and the spenders list their players. The steps left and a countdown are shown. You can continue from the same point later."],
        ["Reset progress", "Clears the saved progress; everything starts over."],
        ["Rules by account role", "For each account role other than Main, limits what is signed from Scout (Sellable / Card / Cheap) and gives the role its own price limit. The spender line counts too."],
        ["Treat Base players as sellable", "Players in a team whose actually paid salary is at or below Base count as Sellable and are not turned into cards."],
        ["Use tomorrow's Base", "The salary is compared with tomorrow's Base (Base × 0.95): with Base 50 a 50-salary player is not Base, a 48-salary one is."],
        ["Use friends' Scouts (spender network)", "After their own Scout the accounts also look at their friends' Scouts. Auto Trade makes the friendships itself; Main's friend list is never touched. A Satılabilir / Stok player on the Scout of a spender whose turn in this run is still to come is left alone: that spender signs it itself in its turn (no trade back needed). What the spenders sign (Satılabilir / Stok) goes to the market as soon as each side's turn ends (not only at the end of the cycle). When Auto Trade stops for another task (e.g. a listing by hand) the spenders still list first; only your second Stop cuts that."],
        ["Auto Pricing tab", "The price at which the spenders list Sellable and Stock players. At the top there are two default prices: Sellable (20 APK at first) and Stock. Below, for every player with the Sellable or Stock role: its own price, a price used when it was signed 5% off, and a “Lv30+ only” box. Players without a price are marked orange and listed at the default price. Changes are saved at once and count while Auto Trade runs too."],
        ["5% off price", "Used when the player was signed 5% off by a Lv30+ account (at Base or not). Example: a player valued 2470 signed 5% off at 2347 is listed at the 5% off price you entered for it. Empty means its normal price."],
        ["Lv30+ only", "A Sellable player you mark is signed only by Lv30+ accounts, like Stock: first a Lv30+ spender, otherwise another Lv30+ account through a friend for the moment. For Stock players this is always on."],
        ["Fire if not 5% off", "When a player you mark was not signed 5% off, the spender does not list it but fires it; when it was signed 5% off it is listed as usual. It gets rid of junk copies. Firing cannot be undone; ticking the box asks first and every fire is written to Activity."],
        ["Spender friends per account", "How many spenders each account is friends with; when one runs out of TK the next one signs."],
        ["Spender TK floor", "A spender that would fall under this TK after a signing is not used."],
        ["Build the friend network now", "Makes the friendships right away instead of waiting for the cycle."],
        ["Spender market list", "Players the spenders put on the market: Value, Salary, Base and sale price. Select rows and use “List selected again” or “Take selected off market and fire”; every row has its own buttons too."],
        ["List on market", "At the end, the players left on the sides: choose price and currency and list. Fire / Fire all on a row fires them (asks first)."],
        ["Players turned into cards", "How many players became cards in this run and in total; “Reset table” clears the numbers."]
      ],
      rules: [
        "Before starting, the rosters and TK of the chosen accounts are read without signing in. Accounts under level 10 are not used (trading opens at level 10 in the game).",
        "A roster is 5 + 6 = 11; only the bench is used. Equipped, X and temporary players are never moved.",
        "Main goes to Scout and signs every suitable player; when the bench is full it turns the card players into cards and gives the side-bound ones to the side with the most TK.",
        "Then the sides open from the most TK to the least. The side makes the room, Main joins with the password; one trade carries both directions and each side gives at most 5 players. The TK difference is the difference between the players' salaries.",
        "A side without enough TK is skipped. If a problem cannot be solved, the work stops; fix it and press “Continue where it stopped”.",
        "When Main is running out of TK the work does not stop: sides sign players for Main only as far as Main can pay for them in the trade. In Main's own Scout a player it cannot afford is skipped and cheaper ones are still signed. If Main still cannot pay a whole trade, the part it can pay goes through; the rest waits on the side and is written to Activity.",
        "When Auto Trade is stopped (by hand, by “Stop all automations” or by a scheduled task such as PVP) or stops with an error, the cheap players on the sides first go to main or are fired and the spenders list their players. So salary caps do not stay full and tournaments are not missed. Press Stop a second time to stop at once.",
        "Main's TK is counted for all sides together: the sides (on their own Scouts and on friends' Scouts) never buy more than main can pay. When main's TK is too low for the cheap players Auto Trade gives a notice and stops; send TK to main and press Continue.",
        "A few sides work at the same time (the number in the settings); trades with main still go one by one. Live status shows how many accounts of this cycle are done, when the cycle should end, and the active time of Auto Trade (stops and pauses not counted). A friend's Scout read once is not read again before its own refresh (30 minutes).",
        "Base rule: for a player whose value fell below its Base, the player counts as Base when its salary is at or below value × 0.95. A player whose salary equals its value is not Base.",
        "If a player's roles point both ways (e.g. Sellable + Card), Auto Trade stops and asks: turn into card, keep as sellable or leave it.",
        "Spender: a spender with enough TK signs a Sellable / Stock player directly. When its roster is full or the same player comes, it lists all the Sellable / Stock players on its bench at once.",
        "If no spender can sign (daily limit, no TK), Main or a side signs and gives the player to a spender in a trade; if that fails too, the side keeps it.",
        "At the end of every cycle and at the start of a run every spender's bench is checked, so no Sellable / Stock player is left unlisted.",
        "Stock players are signed only by accounts at level 30 or higher. Order: a level 30+ spender first, otherwise another level 30+ account. If they are not friends, a temporary friendship is made and removed after the signing. If there is no level 30+ account, the player is skipped and Activity says so.",
        "For speed, spender connections are kept open for a few minutes (at most 4), so a listing or trade does not wait for a new sign-in.",
        "In a loop each account gets its turn again when its Scout refreshes (30 minutes). At the end of each cycle the Main cards are scanned.",
        "The form choices are saved as you change them; the page comes back with your last choices after closing it or restarting the app."
      ],
      tips: [
        "In the spender market list a row whose price you change is selected by itself; a row listed again successfully leaves the table. Your selection is kept when you go to another page and come back.",
        "When you list or fire on an account by hand, Auto Trade waits only on that account; the whole run does not stop.",
        "At the end an “Auto Trade finished” entry with the numbers signed, turned into cards and traded is written to Activity.",
        "If a player you do not know keeps being signed, look at “Players with a role that are not in the list” under Cards → Player List; an old role may be left there."
      ],
      problems: [
        ["“Auto Trade stopped · needs you”", "The error box says why (not enough TK, the player is already on the other account…). Fix it in the game and press “Continue where it stopped”."],
        ["“Waiting for a market listing”", "A side's roster is full of players that stay. In the window choose for every player: List (the price comes from Auto Pricing, you can change it), Fire (cannot be undone) or Hold (stays in the roster, shows in “List on market” under the page and is not asked about again). The “All:” buttons give every player the same choice. OK opens once every player has a choice; the work is done and Auto Trade goes on."],
        ["A Stock player was not signed", "Stock needs an account at level 30 or higher. A “Stock skipped” entry in Activity means there was no account at that level."],
        ["A player was left on a spender's bench", "It is put on the market by itself at the end of the next cycle or on the next start."]
      ]
    },
    {
      id: "pvp", icon: "⚔️", name: "PVP Arena",
      what: "The selected accounts play PVP Arena until their 10 daily attempts are used. Each account's attempts left, PVP points, points gained today and league are shown.",
      steps: [
        "Press “Refresh status” to see whether the arena is open and the attempts left.",
        "Select the accounts (a group's box selects them all).",
        "Press “Start PVP”. Auto Play stops on those accounts and starts again when PVP is over.",
        "A per-account result table shows at the bottom while it runs and afterwards."
      ],
      buttons: [
        ["Refresh status", "Reads arena status, attempts and PVP points from the game."],
        ["Start PVP", "Starts PVP on the selected accounts."],
        ["Stop", "Stops PVP."]
      ],
      rules: [
        "Each account loops “find a match → let it end → find again”. The accounts run side by side; one stopping never stops the others.",
        "The arena opens every day at 05:00 and 17:00 (TR). If it is closed or closes, that account stops with “PVP is not active right now”.",
        "Attempts reset every day at 19:10. The “Today” column shows the points gained since 19:10.",
        "If the arena is closed when the daily PVP starts, Auto Play is not stopped; PVP starts the moment the arena opens. If it does not open within 3 hours, that day's PVP is skipped.",
        "If an account is already in a match, that match ends first."
      ],
      tips: ["League names (Rookie III … GOAT) follow the game's point bands."],
      problems: [
        ["The screen went white during PVP with many accounts", "This is fixed: the window is no longer updated that often. If the window still crashes it is reloaded by itself, PVP goes on and Activity gets an “app window crashed” entry."]
      ]
    },
    {
      id: "tower", icon: "🗼", name: "Tower",
      what: "Plays the Challenger, Threat and Rival towers floor by floor on the selected accounts. The towers go back to floor 1 every Sunday at 19:10 (TR).",
      steps: [
        "Select the accounts.",
        "Set the “Losses in a row” limit at the top (default 2).",
        "Press “Start Tower”. Auto Play stops and starts again when the tower is over."
      ],
      buttons: [
        ["Start Tower", "Starts on the selected accounts."],
        ["Stop selected / Stop all", "Stops only the ticked accounts or all of them."],
        ["Losses in a row", "After how many losses on the same floor a tower is given up (at least 1); the last number is remembered."]
      ],
      rules: [
        "The lowest floor of every tower is played first, then the next floors.",
        "When the losses-in-a-row limit is reached on one floor, that tower is given up; when all three are done or given up, the account stops.",
        "Over the salary cap: that account stops with a warning."
      ],
      tips: ["The last-run table shows wins / losses and the floor reached per tower."],
      problems: []
    },
    {
      id: "daily", icon: "📅", name: "Daily",
      what: "All daily modes on one page, in tabs: Go-up, Professional, Daily Boss, Elite Ascent, Big 3 (Magic Team), Props, Daily Quiz, Cheer, Chat and Daily Slot. All of them run without a browser.",
      steps: [
        "Choose a tab at the top.",
        "Select the accounts and press the tab's Start button.",
        "The “How does it work?” box under each tab explains the mode's rules."
      ],
      buttons: [
        ["Daily Slot", "The daily slot of the Daily Sign-in window (1 spin a day, 3 prizes). “Check status” shows, signing in to no account, whether each account spun today and, if it did, the 3 prizes it won (accounts you spun yourself in the game too). “Spin all” spins the slot on the chosen accounts that have not spun: it uses the account's open connection in the app, spins after the match when Auto Play is in one, otherwise it signs in. Today's prize totals show at the top, the prize pool with its chances at the bottom."],
        ["Go-up", "The selected accounts queue and play point matches until their 2 daily attempts are used; “All at once” or “One by one” (wait between accounts). League, season and total points are in the table."],
        ["Professional", "Plays season and playoff matches until the daily attempts are used; then a Props refresh is made with the match card (at most 2 a day). In the Hall of Fame you pick the opponent; on a playoff champion “Start Hall of Fame” opens the new season."],
        ["Daily Boss", "Each account plays its 2 daily attempts against the chosen boss; a boss above the account's level cannot be chosen. “Apply to all” picks the strongest suitable boss for every account."],
        ["Elite Ascent", "Each account plays the bot on its floor and moves up on a win; 2 free attempts a day."],
        ["Big 3 (Magic Team)", "A level 15 trio active in the Office beats the MIAMI and PHILADELPHIA bots and the prize is claimed by itself."],
        ["Props", "At halftime fills the stamina of the starting five with water bottles: a +30 at 75 or below, a +10 from 76 to 94; it stops at 95. Example: a player at 15 gets 3 × +30, one at 55 gets +30 then +10."],
        ["Daily Quiz", "Every account's quiz shows on its card at the same time; known questions are answered automatically, you answer new ones (random after 8–9 s)."],
        ["Cheer", "If the chosen account is in a match, the other selected accounts cheer for its team."],
        ["Chat", "Writes the message list in order to the global chat, each message by its own account, at least 11 s apart; a number of loops or endless."]
      ],
      rules: [
        "These modes stop Auto Play on their accounts first and start it again afterwards.",
        "Paid attempts, tickets, the Go-up shop, the Cheer item in the bag and megaphones are never used.",
        "Big 3 and Daily Boss matches count against the daily PK limit.",
        "Every new question you answer in the Quiz is learned for good; even a factory reset keeps it.",
        "A Chat message is at most 50 characters, with at least 11 seconds between messages (the game's limit).",
        "Props does nothing in the 3rd or 4th quarter (halftime has passed); in the 1st or 2nd quarter it waits for halftime.",
        "Elite Ascent and Props need a sign-in; the account is signed out wherever else it is open."
      ],
      tips: [
        "“Game chat” on the Chat tab shows the global chat; your own accounts' messages are orange.",
        "The time spent in the Go-up queue and in the match is shown live."
      ],
      problems: []
    },
    {
      id: "office", icon: "🏢", name: "Office",
      what: "The two systems of the game's Office building: Coach (strategy training) and Big Three (trios of NBA teams, Super Big 3). Tickets are never spent.",
      steps: [
        "Press “Read status” to read the coach, Master cards, daily attempts and trios of every account.",
        "Start a training with “Run now” on an account, or tick “Auto”: the app does the same every 10 minutes."
      ],
      buttons: [
        ["Inspect coaches", "The 8 coaches, their strategies and levels, and which tactic beats which. A coach is chosen only with “Choose this coach” and a confirmation; the first coach is free, changing costs 1 Change Coach Card."],
        ["Run now (Coach)", "Collects the finished training; starts a new 3-hour training when a free attempt, a Master card and a strategy to train are there."],
        ["Run now (Big Three)", "Collects the finished training and starts a new 3-hour one if an attempt is left."],
        ["+Offense / +Defense", "Spends the bonus points of a level-up."],
        ["Activate / Turn off", "Turns the Big3 bonus on in matches; the trio must be active for Magic Team matches."],
        ["Super Big 3", "Pick 3 players from your roster to make your own trio. Changing the trio resets all its progress (it asks first)."]
      ],
      rules: [
        "The coach has 2 free trainings a day; more, intense training and finishing early need tickets, which the app never uses.",
        "No Master card is spent when there is no strategy to train.",
        "After level 15 a Big3 trio can train up to 20 with the Daily → Big 3 prize."
      ],
      tips: [], problems: []
    },
    {
      id: "autobuy", icon: "🛒", name: "Auto Buy",
      what: "Keeps searching the Trading Hall for the players on the watch list and buys a listing that meets every condition with the first account in priority order that can pay. A bought player is put on the market at 9,999,999 TIX right away; you give the real price later.",
      steps: [
        "Add the players to watch with “Add player” (or in bulk from the Players page).",
        "For each player enter Salary ≤, Price ≤ and the currency (APK / TIX); choose how many to buy (unlimited by default).",
        "Set the account priority (1, 2, 3…).",
        "Press “Start Auto Buy”.",
        "List the bought players again at your price in “Bought players”."
      ],
      buttons: [
        ["Salary range / Price ≤ / APK-TIX", "A listing is bought only if all hold (Price ≤ 20 APK never buys a 21 APK listing). An empty lower salary limit counts as 0."],
        ["+ Salary range", "Adds a new salary range with its own price and quantity for the same player. Example: Jokic up to 40 APK at salary 0–2318, up to 25 APK at 2319–2347. A new range starts one above the previous one; add as many as you like. An overlapping range shows a red warning. The player is searched once per scan and a listing is compared with the price of the range its salary falls in."],
        ["Count", "How many of each player to buy; ↺ resets the counter."],
        ["Account priority", "When an account runs out of money, or already has the player, the next one is used."],
        ["Update price", "Takes the bought player off the market and lists it at your price."]
      ],
      rules: [
        "Auto Buy scans without signing in and can run next to the other automations. It signs in on an account only to buy or change a price.",
        "Meanwhile Auto Play and Tower on that account are paused and started again afterwards. If Auto Trade is not on that account right now, it only waits for that account and keeps running.",
        "When no account can pay the lowest price on the list, Auto Buy stops and says the funds are not enough.",
        "Auto Buy does not start until Salary ≤ and Price ≤ are filled for every active player."
      ],
      tips: ["If a bought player is already in the roster, the “Already owned” method is used by itself."],
      problems: []
    },
    {
      id: "tournament", icon: "🏆", name: "Tournament",
      what: "Registers the selected accounts to the day's tournament for their level. When today's registration is closed it waits for the next one.",
      steps: ["Select the accounts.", "Press “Join Tournaments”.", "The last run report shows who registered and why the others did not."],
      buttons: [["Join Tournaments", "Starts registration."], ["Reload list", "Reads the tournaments again."],
        ["Last run report", "A one-row table: Total accounts · Already in all · Registered · Tournament full · Level too low (and Other when there was an error or a stop). Click a number that is not zero to see those accounts in a small window; click anywhere else or Close to close it."],
        ["Tournaments joined", "Under the report every tournament is listed with how many accounts registered; click the number to see the accounts."]],
      rules: [
        "Tournament days: Monday APK · Tuesday Materials · Wednesday Stone · Thursday Star · Friday Exclusive · Saturday TK · Sunday Ticket; all at 15:00 (TR).",
        "When the daily tournament line in Auto Play is on, registration is done every day by itself."
      ],
      tips: ["Tables show the tournament's name; the level range is in the Lv column."],
      problems: []
    },
    {
      id: "tktransfer", icon: "💸", name: "TK Transfer",
      what: "Moves TK from side accounts to the main account: Main buys the sides' APK listings on the market, gives the players back in a trade (the side pays their salary sum in TK) and the side lists them again at the same price.",
      steps: [
        "First open APK listings on the side accounts (you open the first listings).",
        "Choose the main account and the side accounts.",
        "Enter the minimum salary (0–2500), the maximum APK (at least 20) and the TK to move.",
        "Press “Start” and follow the moved TK in the report."
      ],
      buttons: [["Start", "Stops by itself when the target is passed, APK runs out or no usable listing is left."], ["Stop", "Stops halfway; the TK moved so far is in the report."]],
      rules: [
        "Sides go from the most TK down; at most 5 players are bought from one side at a time.",
        "Only the players it bought are listed again, at the same price.",
        "A player main already owns and a second copy of one player are never bought."
      ],
      tips: [], problems: []
    },
    {
      id: "apktransfer", icon: "🎟️", name: "APK / TIX Transfer",
      what: "Collects the APK, the TIX or both of the chosen accounts on one account (main) through the market. It is the second tab of the TK Transfer page.",
      steps: [
        "Open the “APK / TIX Transfer” tab on the TK / APK Transfer page.",
        "Choose the accounts to use. If main is not chosen, pick the account that collects in “Account to receive”.",
        "Choose what to transfer (APK, TIX or both), enter the minimum APK / TIX and the highest salary of the players main signs (50 TK by default).",
        "Press “Start transfer”; follow the live status and then the report."
      ],
      buttons: [["Start transfer", "Stops Auto Play on the chosen accounts, transfers, then starts it again."], ["Stop", "Stops halfway; the transfers so far and the balances are in the report."], ["Get them from spenders by trade when Scouts are not enough", "When on, the spenders are opened one by one and give cheap players when main's Scout and its friends' Scouts are not enough."]],
      rules: [
        "First the sales of every chosen account are claimed (the claimed players show in the table at the bottom of the report), then the balances are read.",
        "An account under the minimum or with a full roster is not eligible and is skipped; while choosing you see how many are eligible with the current balances.",
        "For every eligible account a cheap player of main is listed for the whole balance of that account. Which account buys which listing is fixed in advance; accounts with the same balance never mix up.",
        "The cheap players come from: main's own Scout (Callback is never used), the Scouts of main's friends, then the spenders (they sign from their own and their friends' Scouts and trade them to main).",
        "Main lists every player right away, so its roster never fills up; 20 accounts can be transferred too. Main needs at least 1 free place.",
        "All accounts buy their own listing at the same time; before buying, the listing is checked: main's, the right player, the right price. Then main claims the sales.",
        "The game keeps max(3, 5%) of every sale. “To main” and “Fee” in the report are the real numbers the game gave; the sum sent is not what main gets.",
        "Players with a role on the Cards page (Card, Sellable, Stock…) are never used for this.",
        "The cheap players stay on the accounts that bought them. A listing nobody bought is taken off the market again.",
        "Your values are remembered for next time."
      ],
      tips: ["Report: at the top the net amount main got per currency, what was sent and the total fee; below, every account's balance before → after, every transfer's player and source, and at the bottom the sales claimed at the start."],
      problems: [["“No player found”", "No player under the salary limit is left in the Scouts and on the spenders. Raise the limit a little or try again when the Scouts refresh."], ["“Main roster is full”", "Free at least 1 place on main and start again."]]
    },
    {
      id: "scout", icon: "🔍", name: "Scout",
      what: "Shows the Scout list of an account with price, role and card status. You can sign players here.",
      steps: ["Choose the account and press “Open Scout”.", "Look through the list and press “Sign” on the player you want."],
      buttons: [["Open / Close Scout", "Loads or closes the list."], ["Call Back", "Refreshes the list (limited per day)."], ["Sign", "Signs the player to the account."]],
      rules: [
        "The list is read without signing in. Sign and Call Back connect as the account; if it is open elsewhere it is signed out there.",
        "Cards and roles match by the game's player id, not by similar names.",
        "The counter at the top right shows when Scout refreshes by itself."
      ],
      tips: ["Players signed by Auto Trade show as “Signed”."],
      problems: []
    },
    {
      id: "players", icon: "📈", name: "Players",
      what: "Every player of the game: team, rating, position, value, Base and today's value change (green up, red down).",
      steps: ["Filter for the players you look for.", "Give roles with “Edit roles” if needed (shared with Cards)."],
      buttons: [
        ["Filters", "Name, team, position, role, rating and distance from Base."],
        ["Edit roles", "Gives roles like Card / Sellable / Stock."],
        ["Refresh", "Reads the list now."]
      ],
      rules: [
        "Values change every day at 11:00; the list is renewed at 11:05 (or right away when the game says the update is done). A scan by hand during the day keeps the day's rises and falls.",
        "The orange BASE badge means the value is at Base. The “At / under Base” part uses the same rule as the Command Center."
      ],
      tips: ["A red + after a name means injured, an orange + a short injury; hover it for the return date."],
      problems: []
    },
    {
      id: "valuepredict", icon: "🔮", name: "Value Prediction",
      what: "Predicts the next value change of the players from the NBA games. The game ranks players by offense + defense and the value follows that rank.",
      steps: ["Open the page; the prediction renews itself every 30 minutes.", "Press “Update now” to renew it right away.", "After values change, “Prediction vs actual” shows how close it was."],
      buttons: [
        ["Update now", "Reads newly finished NBA games and renews the prediction."],
        ["Role column", "Gives the Cards roles here too."],
        ["Prediction vs actual", "The earlier prediction next to the actual change, with the average error and how often the direction was right."]
      ],
      rules: [
        "The game starts moving a player's value once he has played 5 games this season; the Games column is his own game count.",
        "An update recomputes only the players who played in games finished before 11:00 and have at least 5 games; the others move only by rank.",
        "A player listed “Out” on the ESPN injury list is taken to miss a game not played yet.",
        "In one update offense / defense move at most: S+ 3% of the value, S 4%, S- 5% (at least 5); A+ 12, A 14, A- 16, B+ 18, B 20, B- 22, C+ 15, C 16, C- 18, D+ 20, D 22, D- 24.",
        "The formula is learned again after every update, so predictions get better over time. NBA data comes from ESPN's public data."
      ],
      tips: [], problems: []
    },
    {
      id: "draft", icon: "🎯", name: "Draft",
      what: "Watches the live draft rooms and shows which account can join which room; you make the picks. Every pool player shows price, salary, Base, roles and card status.",
      steps: ["Press “Join” next to the account in a room it may join.", "When it is your turn the app comes to the front; pick with “Pick for …” (within 30 seconds).", "After the draft put the drafted players on the market with “List selected”."],
      buttons: [["Join", "Puts the account into that room."], ["Pick for …", "Picks the player when it is that account's turn."], ["Price / Roles header", "Sorts the pool by price or by role."], ["List selected", "Puts drafted players on the market."]],
      rules: ["Once in a room you stay until the draft ends; attempts are read again afterwards.", "A player put on the market leaves the list."],
      tips: [], problems: []
    },
    {
      id: "cards", icon: "🃏", name: "Cards",
      what: "The main account's Star Cards (teams, stars, card counts) and the place where players get their roles. The Synthesis and Activate tabs are here too.",
      steps: [
        "Press “Refresh” to scan the main account's cards.",
        "On the Player List tab select players and give Card / Sellable / Stock with “Bulk role” or the row's role button.",
        "If the “Players with a role that are not in the list” table shows under the list, check it and remove roles you do not need.",
        "On the Synthesis or Activate tab choose the levels and start."
      ],
      buttons: [
        ["Refresh", "Scans the cards again; a player who changed team moves to the new team."],
        ["Add role / Bulk role", "Creates roles and gives them to the selected players."],
        ["Reset card data", "Clears the scanned card data (roles stay)."],
        ["Players with a role that are not in the list", "Players not seen in the last scan (no card left, or an old record) that still have a role. Auto Trade treats them by their roles. The × next to a role removes it, “Remove roles” removes them all. The table is hidden when there are none."],
        ["Synthesis · team players", "Combines 4 cards of the same player at the same level into the next level."],
        ["Synthesis · No Team", "Uses one card each of the 4 different No Team players with the most cards; success gives a random next-level card."],
        ["Synthesis · levels", "1★→2★ … 4★→5★; unticked levels are skipped."],
        ["Activate", "Activates cards player by player in the chosen stars, the highest first (the game's “activate all” is never used)."]
      ],
      rules: [
        "Auto Trade reads roles and teams from here.",
        "Player teams come only from the game; teams are not set by hand.",
        "Synthesis never touches X players. On a failed synthesis one card comes back at the same level; the result is decided from the card inventory.",
        "Activate: the game always activates a player with its highest card, so a player whose highest card is in a star you did not choose is skipped."
      ],
      tips: ["In the synthesis summary green is successful, red is failed tries."],
      problems: [["Auto Trade signs a player that is not in the list", "Remove that player's role in the “Players with a role that are not in the list” table."]]
    },
    {
      id: "equipment", icon: "🧤", name: "Equipment",
      what: "Shows the equipment and materials in an account's bag and does Convert, Craft, Enchant, Enhance, Refine, Collections and Skills without opening the game.",
      steps: ["Choose the account and press “Scan”.", "Choose the action on a tab, pick the piece and the amount, apply.", "When done press “Close” to close the account's session."],
      buttons: [
        ["Convert / Craft / Enchant / Enhance / Refine", "The same actions as in the game. Convert and Craft make at most 100 at a time."],
        ["Prepare (collection)", "Makes the missing pieces of a set, raises them to the needed + level and registers them. Several sets and accounts can be done at once."],
        ["Clicking a piece (collection)", "Prepares and registers only that piece."],
        ["Skills", "Shows the skills of the 11 containers; a container is assigned to a player, skills are locked and 2 free shuffles are made a day."]
      ],
      rules: [
        "A collection takes a piece only at exactly the required + level.",
        "If Refine Stones run out during enhancing it stops and shows the “Last enhance report”.",
        "Shuffles and slots that need tickets are never used.",
        "Equipment work needs a sign-in; the account is signed out wherever else it is open."
      ],
      tips: ["A failed enhance is the game's normal chance, not an error."],
      problems: []
    },
    {
      id: "market", icon: "🏪", name: "Market",
      what: "Scans the accounts' market listings, collects the money of sold players and relists expired ones.",
      steps: ["Select accounts and press “Scan selected”.", "Collect the sales with “Claim only accounts with sales”.", "Load the expired ones with “Load expired”, give a price and put them back with “List selected”."],
      buttons: [
        ["Scan selected", "Reads the listings."],
        ["Claim sales of selected / Claim only accounts with sales", "Collects the money of the sales."],
        ["Load expired / List selected", "Relists expired players at a new price; “Suggest” proposes a price from the cheapest rival listing."],
        ["Accounts at once", "How many accounts scan and claim at the same time; scheduled claiming uses it too."],
        ["Take off market / Take off and fire", "Takes the selected listings back to the roster; “Take off and fire” asks first, then takes them off and fires them (cannot be undone)."],
        ["Group row", "The row of grouped accounts shows the group's totals: Listed, Sold, Expired and the latest scan time. When accounts have errors it says “1/10 Error” (1 of 10 accounts has an error; hover to see why). Scan scans every account of the group, Claim collects the sales of those with sales."]
      ],
      rules: [
        "Before every sale, cancel and claim, the game's market wait time is asked and exactly that long is waited.",
        "“Already owned” listings can be listed too; the app tries the Already owned method.",
        "A player taken off the market that cannot be listed again is marked and stays in the roster."
      ],
      tips: ["Tables show Value, Salary and Base together; a BASE badge appears when the salary is under Base."],
      problems: []
    },
    {
      id: "trade", icon: "🏛️", name: "Trading Hall",
      what: "Scans the game's Trading Hall and lets you filter by price, salary, Base, value and value change. You can buy players here and turn them into cards.",
      steps: ["Scan with “Refresh Trading Hall”.", "Filter with the filters or presets.", "On a listing choose the account in “Buy ▾”.", "In “Bought players” give a price and list them, or (if bought with Main) turn them into cards."],
      buttons: [
        ["Refresh Trading Hall / Stop at price", "Scans from the start; stops at the given price."],
        ["Presets and filter groups", "Player, Salary, Price, Base and Auto Buy groups; Reset clears them all."],
        ["Buy ▾", "Accounts are sorted by the listing's currency, most first; those that cannot pay are greyed out."],
        ["Bought players", "Give a price and currency and list; a listed player's price is updated."],
        ["Turn into card", "Only for players bought with Main; warns first if the salary is far under the value or it is a Base player."],
        ["Auto Buy labels", "Meets the conditions, Watched · salary matches, Watched, Not watched."]
      ],
      rules: ["A few seconds pass between two purchases; the game treats very fast buying as abuse.", "Base only shows the same listings as the game's “Base only”."],
      tips: [], problems: []
    },
    {
      id: "owned", icon: "♻️", name: "Already owned method",
      what: "The game does not let an account buy, sign from Scout or take back from the market a player it already has. The app then parks the roster copy on the market for a while, does the work and brings the original back with everything it had. Auto Buy, relisting and Auto Trade use it by themselves.",
      steps: [],
      buttons: [
        ["1 · Preparation", "The copy's equipment, skill and the starting five are noted; equipment and skill are removed and the player is parked on the market at 9,999,999 TIX."],
        ["5-player roster", "The roster cannot go down to 4, so a listing of the account's own market is taken back first."],
        ["2 · The work", "The player is bought, signed from Scout or listed at the new price."],
        ["3 · Restore", "The original is taken back from the market, the same equipment and skill are put on and the starting five go back to their places; the listing taken back is listed again at its old price."]
      ],
      rules: ["If the account has no listing at all and the roster has 5 players: Scout skips the player, Auto Buy tries the other accounts.", "Every step is written to Activity; if a piece cannot be put back, it says which one."],
      tips: [], problems: []
    },
    {
      id: "activity", icon: "📜", name: "Activity (Logs)",
      what: "A record of everything the app did: successes, warnings and errors. The first place to look when something goes wrong.",
      steps: ["Filter with Account, Service and Type.", "For older days use the day choice or search all days."],
      buttons: [
        ["Account / Service / Type filters", "Show only what you need."],
        ["Day choice and search", "Opens older days and searches all of them."],
        ["Save error report", "Saves the warnings and errors of the last days to a file (no passwords)."],
        ["Log folder", "Opens the folder of the daily log files."]
      ],
      rules: [
        "Each day is kept in its own file for 30 days.",
        "If a service's connection drops because the account was opened elsewhere, it says which service dropped and who took the account.",
        "If two services keep taking one account from each other, the wait grows; after 5 times in 10 minutes the service stops reconnecting."
      ],
      tips: ["After a PVP run a per-account result table shows at the top."],
      problems: []
    },
    {
      id: "settings", icon: "⚙️", name: "Settings",
      what: "Language, look, menu layout, app behaviour and factory reset.",
      steps: [],
      buttons: [
        ["Language", "Turkish, English, Filipino or automatic by the system language."],
        ["Look", "Dark or Light mode; applied at once and remembered."],
        ["Menu layout", "Changes the names and order of the sidebar lists and where pages are; “Back to default” restores it."],
        ["App behaviour", "Keep running in the tray when the window is closed, and start with Windows."],
        ["Factory reset", "Puts the app back to a fresh install; with “Keep saved passwords” the accounts stay. The answers learned by the Quiz are always kept."]
      ],
      rules: [], tips: [], problems: []
    },
    {
      id: "troubleshoot", icon: "🛟", name: "Troubleshooting",
      what: "Common situations and what to do.",
      steps: [],
      buttons: [],
      rules: [],
      tips: ["For a problem you cannot solve, make a file with Activity → “Save error report” and note when it happened."],
      problems: [
        ["The screen went white but the work goes on", "The window crashed while the automations keep running in the background. The app now reloads the window by itself; if it does not, close and open the app."],
        ["A yellow bar is at the top", "The game cannot be reached. Do nothing; everything continues by itself when the game is back."],
        ["An account gets signed out of the game", "Work that needs a sign-in is running on that account (Scout signing, Equipment, Elite Ascent…). Reading never signs it out; you can use the account as soon as that work is done."],
        ["An automation says another system uses the account", "Stop the work on that account first, or choose “Stop and start”; the stopped system starts again by itself afterwards."],
        ["Something is signed with the wrong role", "Check the player's role in Cards → Player List; if it is not in the list, look at the “Players with a role that are not in the list” table under it."],
        ["A change does not show", "Close the app completely and open it again."]
      ]
    }
  ]
};
