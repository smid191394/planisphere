## ADDED Requirements

### Requirement: A reader with nothing to draw is offered a drawing
Where the command cannot produce a drawing — no folder is open, or the folder holds no analyzable source — the viewer SHALL offer a sample project that ships with the product, and produce a drawing of it when the reader accepts.

The sample SHALL be analysed on the reader's machine rather than shipped already drawn. An artifact records absolute paths, so one made elsewhere names files that are not there and every jump from it fails; the gesture the product is for must work in the first drawing a reader sees. Analysing it also says that the install works, which is the first thing to establish when something else does not.

The sample SHALL be of a language that needs nothing installed, so that the offer holds for a reader who has no toolchain at all.

The drawing SHALL be begun when the offer is made rather than when it is accepted. Drawing the sample costs about a second and a half, almost all of it the compiler being loaded, and the reader spends longer than that reading the message it is offered on; begun then, it is waiting by the time they answer. Where they never answer, a second of work is thrown away, which is what the offer is worth.

What a reader waits for after accepting SHALL be the panel opening and nothing else, and where the drawing is already made — the same reader, later — nothing SHALL be drawn again.

The offer SHALL NOT add anything to the command palette or to the explorer's menu. A reader who draws their own projects never meets these messages, and a way in that is used once should not be carried for ever by everyone.

#### Scenario: Nothing is open
- **WHEN** the reader runs the command with no folder open
- **THEN** they are told to open a folder, and offered the sample in the same message

#### Scenario: The folder holds nothing this product reads
- **WHEN** the reader runs the command on a folder holding no analyzable source
- **THEN** they are told so, and offered the sample in the same message

#### Scenario: The sample is drawn without a toolchain
- **WHEN** a reader with no language toolchain installed accepts the offer
- **THEN** a drawing of the sample is produced and opened

#### Scenario: The drawing is waiting when the offer is answered
- **WHEN** the reader accepts the offer after reading the message
- **THEN** the drawing opens without the sample being analysed then

#### Scenario: The same reader, later
- **WHEN** the reader is offered the sample again, and it has been drawn already
- **THEN** it is not drawn again

#### Scenario: The sample's nodes open their source
- **WHEN** the reader activates a node of the sample drawing twice
- **THEN** the file it names is opened, as it would be for a drawing of their own project

#### Scenario: The offer is not a command
- **WHEN** the reader searches the command palette
- **THEN** the sample is not among the commands

### Requirement: What the viewer says about an empty drawing names no language
Where a drawing holds nothing to show, what the viewer says SHALL NOT name one of the languages the product reads. The artifact records no language, and a reader of a Go project told that no Python symbols were found learns only that the product is confused.

#### Scenario: An empty drawing is opened
- **WHEN** a drawing with no nodes is opened
- **THEN** the viewer says it is empty without naming a language
