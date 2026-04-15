# C4 Diagrams
```mermaid
C4Context
    title System Context diagram for the Forecast in a Box: local usage

    Enterprise_Boundary(b0, "Personal Laptop") {
        Person(user, "Meteorologist", "Domain expert with low-to-medium technical proficiency")
        System(fiab, "Forecast-in-a-Box", "Components on the laptop")
    }
    Enterprise_Boundary(b1, "Cloud Services") {
        System(mars, "Initial Conditions", "MARS, Open data, ...")
        System(models, "Model Registry", "AIFS Catalog")
    }

    Rel(user, fiab, "Enters product/forecast configuration")
    Rel(fiab, user, "Displays charts, provides outputs")
    Rel(fiab, mars, "Pulls data from")
    Rel(fiab, models, "Pulls checkpoints from")

    UpdateRelStyle(user, fiab, $textColor="red", $lineColor="blue", $offsetY="-20")
    UpdateRelStyle(fiab, user, $textColor="green", $lineColor="blue", $offsetY="+20")
    UpdateRelStyle(fiab, mars, $textColor="yellow", $lineColor="yellow", $offsetY="+20", $offsetX="-15")
    UpdateRelStyle(fiab, models, $textColor="yellow", $lineColor="yellow", $offsetY="+20", $offsetX="-15")
```
Note: for HPC cluster usage, the only difference would be of Forecast-in-a-Box system living wholly on
a cluster, but system-wise all relationships and other boundaries remain the same.

```mermaid
C4Context
    title Container diagram of the Forecast in a Box system, deployed locally

    Person(user, "Meteorologists")
    Person(tech, "Support", "Operator, developer")
    System_Ext(mars, "Initial Conditions", "MARS, Open Data, ...")
    System_Ext(models, "Model Registry")
    System_Ext(auth, "Authentication", "OAuth")

    Container_Boundary(c1, "FIAB") {
        Container(web, "Single-Page App", "JavaScript index.html")
        Container(backend, "Backend", "FastAPI")
        ContainerDb(sqlite, "SQL Db", "SQLite with job history, schedules")
        Container(cascade_gw, "Cascade Gateway", "Managing executed jobs")
        Container(cascade_ct, "Cascade Controller", "One for each job")
    }

    Rel(web, backend, "Served by")
    UpdateRelStyle(web, backend, $textColor="green", $lineColor="blue", $offsetY="-20", $offsetX="-30")
    Rel(backend, web, "Exposes API to")
    UpdateRelStyle(backend, web, $textColor="red", $lineColor="blue", $offsetY="30", $offsetX="-40")
    Rel(backend, sqlite, "Stores data in")
    UpdateRelStyle(backend, sqlite, $textColor="yellow", $lineColor="yellow", $offsetY="30", $offsetX="-40")
    Rel(backend, cascade_gw, "Submits jobs, retrieves results")
    UpdateRelStyle(backend, cascade_gw, $textColor="yellow", $lineColor="yellow", $offsetY="30", $offsetX="-40")
    BiRel(cascade_gw, cascade_ct, "Spawns, receives reports")
    UpdateRelStyle(cascade_gw, cascade_ct, $textColor="yellow", $lineColor="yellow", $offsetY="30", $offsetX="-40")

    Rel(user, web, "Clicks on Things, Marvels at Results")
    UpdateRelStyle(user, web, $textColor="pink", $lineColor="pink", $offsetY="30", $offsetX="-40")
    Rel(tech, backend, "Inspects logs, Configures")
    UpdateRelStyle(tech, backend, $textColor="pink", $lineColor="pink", $offsetY="30", $offsetX="-40")

    Rel(backend, auth, "Authenticates at")
    UpdateRelStyle(backend, auth, $textColor="cyan", $lineColor="cyan")
    Rel(backend, models, "Fetches metadata")
    UpdateRelStyle(backend, models, $textColor="cyan", $lineColor="cyan")
    Rel(cascade_ct, mars, "Pulls from")
    UpdateRelStyle(cascade_ct, mars, $textColor="violet", $lineColor="violet")
    Rel(cascade_ct, models, "Pulls checkpoints from")
    UpdateRelStyle(cascade_ct, models, $textColor="violet", $lineColor="violet")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```
Note: the difference between local and cluster deployments is just in whether the containers are all co-located, or live at different machines.
In principle, there is no co-locality requirement whatsoever.
