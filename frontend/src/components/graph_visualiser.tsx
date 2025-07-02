
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.


import { useState } from "react";
import { ExecutionSpecification } from "./interface";
import { ActionIcon, Button, Group, Menu, useMantineTheme } from "@mantine/core";

import GraphModal from "./shared/graphModal";
import {useApi} from '../api';

import { IconBookmark, IconCalendar, IconChevronDown, IconTrash } from '@tabler/icons-react';
import classes from './graphVisualiser.module.css';


interface GraphVisualiserProps {
    spec: ExecutionSpecification | null;
    url: string | null;
}

export default function GraphVisualiser({ spec, url }: GraphVisualiserProps) {
    const [graphContent, setGraphContent] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const api = useApi();
    const theme = useMantineTheme();

    const getGraph = (options: { preset: string }) => {
        const getGraphHtml = async () => {
            setLoading(true);
            (async () => {
                try {
                    let response;
                    if (spec) {
                        response = await api.post(`/v1/execution/visualise`, { spec: spec, options: options });
                    } else if (url) {
                        response = await api.post(`${url}`, { options }, { headers: { "Content-Type": "application/json" } });
                    } else {
                        throw new Error("No valid source for fetching the graph.");
                    }
                    const graph: string = await response.data;
                    setGraphContent(graph);
                } catch (err) {
                    console.error(err);
                    setGraphContent(err.response.data);
                } finally {
                    setLoading(false);
                }
            })();
        };
        getGraphHtml();
    };
    return (
        <Group wrap="nowrap" gap={0} bg='orange' align="center" justify="center" style={{borderRadius: "0.3rem"}}>
        <Button color='orange' onClick={() => getGraph({ preset: "blob" })} disabled={loading} className={classes.button}>{loading ? "Loading..." : "Visualise"}</Button>
        <Menu transitionProps={{ transition: 'pop' }} position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="filled"
              color='orange'
              size={36}
              className={classes.menuControl}
            >
              <IconChevronDown size={16} stroke={1.5} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconCalendar size={16} stroke={1.5} color={theme.colors.blue[5]} />}
              onClick={() => { getGraph({preset: "blob" }); }}
            >
              Blob
            </Menu.Item>
            <Menu.Item
              leftSection={<IconBookmark size={16} stroke={1.5} color={theme.colors.blue[5]} />}
              onClick={() => { getGraph({preset: "hierarchical" }); }}
            >
              Hierarchical
            </Menu.Item>
            <Menu.Item
              leftSection={<IconTrash size={16} stroke={1.5} color={theme.colors.blue[5]} />}
              onClick={() => { getGraph({preset: "quick" }); }}
            >
              Quick
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <GraphModal graphContent={graphContent} setGraphContent={setGraphContent} loading={loading}/>
      </Group>

    )
}